# VISUAL_REFRESH.md — Refining the Map's dark theme for readability (slice V1.3.1)

**Status:** Approved by the owner, 2026-10-12. **Implemented 2026-10-12, polished through 2026-10-13 and signed off by the owner on 2026-10-13** (measured in BENCHMARKS.md, Map Benchmarks #2 and #3; screenshots in `docs/screenshots/v1-3-1/`). This is the target the V1.3.1 build matches. Decision records: ADR-041, and ADR-042 for the owner-review additions.
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
- **Overlays (§4):** the legend, the page pill and the zoom controls (and the page arrows, until a second critique removed them) share one control style: a solid `--overlay` card (raised night violet) with no outline, an 8 px radius and `--control` cyan icons, hovering to `--overlay-line`. Lines are never filled, so they can't be mistaken for lines (a light `--text-2` outline was, by the owner). The logo's saturated violet was tried first and outshouted the Map. React Flow's attribution label is hidden. The legend is collapsed to a "Legend" button by default, opens as a narrow card of short rows, and remembers in the browser whether it was left open. On a page with doorways it has a row for the dashed doorway box (2026-10-13).
- **The speed fix (§8):** the 5 s `src` panel didn't reproduce (30–141 ms, BENCHMARKS.md Map Benchmark #2); answers are now cached per index version, and the panel says "Refreshing…" while an on-demand summary is on its way.
- **The three-task test (§9), run 2026-10-13,** and what it changed: the line sentences, the arrows' wording and size, the page bar, the solid page arrows, the repo name going home, hover summaries, and search without the repo's name.
- **Night violet + cyan (§2), 2026-10-13:** the owner found the violet-slate surfaces grey and monotone once the overlays took the logo's colours, and picked option C of four whole-screen renders: the logo's night violet for every surface, its violet for the overlays, and its cyan as the one color for things you click.
- **Content first (§2–§5), 2026-10-13,** from the owner's review of an outside critique ("the chrome outshouts the content"): brighter boxes (`--surface` `#22193F`, `--border` `#4B3B85`), a stronger selected fill, a faint dot grid on the canvas (`--grid`), selection lines at 1.5 px instead of 2, quiet controls, a summary's lead that really is its first sentence, "folders and files" instead of "boxes", and a tighter layout (56 px boxes, layers 64 apart, 8 a row on canvases 1,700 px and wider), which fits VS Code's busy levels 10–35% larger.
- **A readable opening size (§4), 2026-10-13:** every level opens at 75% or larger (names at least 11 px); a busy one opens from its top, and the fit button still shows it whole. Measured: every VS Code level checked opens at 0.75–1.0 on 1907 × 998 and 1440 × 900 screens. The owner chose to leave the details panel covering the Map's right edge as it is: moving the Map when the panel opens would be more confusing.
- **A second outside critique (§4), 2026-10-13:** the owner ran the Map past another critique and picked from options rendered on the real Map. A level too big to fit now opens as wide as the canvas allows instead of at the 75% floor. The big page arrows at the canvas's sides are gone: the page pill's buttons, now 36 px, are the one way to turn the page with the mouse. Doorways read "Lines to page 2", unfilled, instead of "Page 2". The boxes with no line on the page sit under a divider, "Not linked to anything on this page" (§4).
- **Signed off** by the owner, 2026-10-13.
- **Narrow windows (§10), 2026-10-24:** the Map works at any window size, down to 200 × 260, for VS Code's panel. Below a floor of 360 × 320 it stops shrinking and the page scrolls; between the floor and normal sizes each surface drops secondary text first. At 1100 × 700 and up it looks exactly as before (screenshots compared byte for byte), except the error banner while the details panel is open, which now keeps to the canvas beside the panel and clear of the page pill. ADR-064.

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
| `--surface` | `#22193F` | boxes, inputs, cards: a step brighter than the canvas, so the content leads |
| `--panel` | `#140E28` | the details panel, drawers, dialogs |
| `--hairline` | `#261B45` | dividers |
| `--border` | `#4B3B85` | box and input borders, defined enough that boxes read as objects |
| `--text` | `#F1EEF8` | primary text: names, headings |
| `--text-body` | `#D3C7EE` | paragraphs: summaries, help |
| `--text-2` | `#B9A9DE` | secondary text, counts, labels |
| `--title` | `#C7B3FF` | **lavender: a description's title** (a summary's tagline, help headings) |
| `--code` | `#D8CAFF` | **lavender: code identifiers in text** |
| `--code-bg` | `#2A1B52` | the chip behind them |
| `--folder` | `#A98BEA` | **lavender: the folder icon**, so folders and files part at a glance |
| `--neutral-edge` | `#7262A6` | ordinary connections, bright enough to follow on the canvas |
| `--select` | `#B58AFF` | **purple: the selected box, its direct links and its dependency path.** Nothing else |
| `--select-fill` | `#3A2178` | the selected box's fill, strong enough that the box is seen before its lines |
| `--agent` | `#F08A4B` | **orange: what Claude Code is touching right now.** Nothing else |
| `--ok` | `#4CC38A` | **green: indexing status only** (the "indexed" dot) |
| `--danger` | `#F07A7A` | error text and a failed stage. *(Added in the V1.3.1 build: the table had no color for errors, and people need to see them.)* |
| `--control` | `#67E8F9` | **cyan (the logo's glow): something you click** — links, text buttons, the overlays' buttons. Content you select (boxes, chips, rows) keeps its own look |
| `--overlay` | `#2A1F52` | raised night violet: every control on the Map (legend, page pill, zoom controls) |
| `--overlay-line` | `#3A2D6B` | dividers inside an overlay, and a control's hover |
| `--overlay-text-2` | `#C9BCEB` | secondary text on an overlay |
| `--grid` | `#262039` | the canvas's faint dot grid |

Lavender (soft, on text and icons) is the brand: it marks names and code, what you read to know what something is. Vivid purple, as a box's 2 px border and fill and as its lines, is the selection. They share a hue on purpose, but never a job: lavender never marks state.

**Syntax colors, inside code only** (the source viewer and search's code lines). The owner asked for code colored as in VS Code, so these are VS Code's **Dark+** palette: `--syn-text #D4D4D4`, `--syn-keyword #569CD6` (const, function, class), `--syn-control #C586C0` (import, return, if), `--syn-string #CE9178`, `--syn-number #B5CEA8`, `--syn-comment #6A9955`, `--syn-type #4EC9B0`, `--syn-function #DCDCAA`, `--syn-variable #9CDCFE`, `--syn-constant #4FC1FF`, `--syn-regexp #D16969`. Inside code they mean token kinds; nothing on the Map uses them.

Purple is never used just because something is interactive. Links and text buttons are `--control` cyan with an underline; bordered buttons use `--text` or a `--control` border, never purple. *(Cyan for links since 2026-10-13; before, they used `--text`.)*

**Contrast:** `--text` and `--text-2` on `--canvas` and `--surface` meet WCAG AA. Information people need to read is never smaller than 12 px.

## 3. Background

- A flat `--canvas`. No starfield, no purple haze or ambient glow, no gradient.
- The grid is optional; if kept, it's barely visible (around 4% opacity). *(Kept since 2026-10-13: a dot grid every 22 px in `--grid`, so a busy level isn't a void with rectangles in it.)*
- No glow on anything, anywhere.

## 4. Map

| Element | Rule |
|---|---|
| Box | `--surface` fill, 1 px `--border`, 8 px radius, a small Tabler outline icon (`ti-folder` or `ti-file`) |
| Box text | name 14–15 px / 500 in `--text`, count 12 px in `--text-2`. **No description inside boxes**; summaries live in the panel |
| Selected box | `--select-fill`, 2 px `--select` border. 232 × 56 like every box (64 tall until 2026-10-13) |
| Claude's focus | 2 px `--agent` border, with a brief pulse when it changes (respects `prefers-reduced-motion`) |
| Unrelated boxes when something is selected | **about 60% opacity** — visible and clickable, but quieter |
| Edges | **directional arrows on every edge**: 1 px `--neutral-edge` normally, 1.5 px solid `--select` for the selection's direct links (2 px until 2026-10-13: merged into shared tracks, they outshone the selected box). Where it adds meaning, label the relationship ("imports") |
| Hover | highlights that box's direct connections without selecting it |
| Spacing | more room between boxes, and the level fits the viewport with comfortable padding. *(Amended 2026-10-13 by the owner: a level never opens smaller than 75%, where box names are 11 px. One too big to read whole opens at 75% from its top, centred across; dragging shows the rest, and the fit button shows all of it. Amended again the same day, from a second critique: such a level opens as wide as the canvas allows, less 72 px each side, between 75% and 100%, because the floor alone left wide empty margins. Measured on VS Code: the busy levels open at 0.78–0.95 on 1907 × 998 and 0.75–0.98 on 1440 × 900, where they all opened at 0.75 before. A paged level that fits is fitted below the page pill's 64 px band, so no box opens under the pill.)* |

*(Amended in the V1.3.1 build, after the owner's first look.)* Lines are **routed**:
- Each line leaves its box's bottom, runs along the empty channel under that row, and goes up or down a lane in the gutter between boxes. It then runs along the channel above its target and drops into the target's top, with corners rounded at 8 px.
- No line crosses a box. React Flow's default curve went straight from box to box and cut through whatever lay between.
- Lines sharing a lane overlap like a bus. The selection's route stays purple and on top.
- **Boxes with no line on the page** sit in their own grid, below the linked boxes or in a column beside them, whichever fits the level larger. A divider sets them apart *(owner's design, 2026-10-13, after a critique read the grid as randomly placed cards)*: a 1 px `--border` line with "Not linked to anything on this page" in its middle, 15 px `--text-2`, across the level when the grid is below (which then starts 120 px under the linked boxes, not 80), or over the column when it's beside (the top level). No arrow ends it and it's dimmer than the lines, so it can't be read as one. A level where every box is linked, or none is, has no divider.
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

**Markdown in summaries:** backtick identifiers render as inline code (monospace in `--code` lavender on a `--code-bg` chip; the chips were dropped for a few hours on 2026-10-13 and the owner asked for them back), never as literal backticks. The lead is the tagline plus the first sentence, even when the next sentence starts with code, and a backtick with no partner is text, not the start of code (2026-10-13). Every expander folds back: "Read full summary" ↔ "Show less", "View all" and "+N more" ↔ "Show fewer". Body text is 14–15 px sans with a 1.5 line height, not monospace.

## 6. Top bar and activity

- **Top bar, left to right:** a small Nebulosity mark and name, the repo as `owner / repo` (prominent), the view title "Dependency map", then a wide search field ("Search files and concepts", `Ctrl K`). A green status dot sits on the right.
- **Activity bar:** a slim bar along the bottom that's always visible. It shows Claude Code's **last 3 actions** ("Reading build/gulpfile.js"), each with an `--agent` dot. It stays slim so the Map remains the focus, and it's never hidden: live activity is the demo's differentiator.
  - *Since 2026-10-24 (owner's pick from two rendered options):* while `show_on_map` has highlighted something, the bar's right end says how many ("3 highlighted") with a cyan **Clear** text button. Esc does the same once nothing is selected: it lets go of the selection first, then the highlights. Clearing also drops the orange outlines left by the tool calls before it (they would otherwise stay for 30 s); a later call outlines its boxes as usual. Before, a highlight stayed until Claude cleared it, the page reloaded or the repo changed. *(2026-10-24, PR #10's review:)* inside VS Code's panel, What depends' highlights are ringed the same way but are the editor's, not Claude's: the count, Clear and Esc leave them, and they go when the pick closes (ADR-062).
  - *(Added in the V1.3.1 build; the `imports` and `architecture` rows since V1.6, which replaced `dependents`, `dependencies` and `path`, ADR-056.)* Each tool call reads as a phrase (`app/map/activity.ts`). A leading `mcp__nebulosity__` is dropped, "+N" counts further paths, and `""` reads "the repo":

    | Tool | Phrase |
    |---|---|
    | `describe` | Reading build/gulpfile.js |
    | `overview` | Reading the repo overview |
    | `search` | Searching · a.ts +2 |
    | `imports` | Following the imports of x.ts (with `to`: Tracing a.ts → b.ts) |
    | `architecture` | Reading how src is organized |
    | `show_on_map` | Showing src/vs +1 on the map |
    | anything else | its name · its first path |

  - The boxes holding what those 3 actions touched keep the `--agent` ring while the action is under 30 s old (the old dock's idle window). show_on_map's highlights keep it until they're cleared.
  - The repo's `owner / repo` comes from its origin remote (`RepoSummary.remote`, API_CONTRACTS.md §15). Without one, it's the folder name.

*(Added in the V1.3.1 build, from the owner's first look.)*
- **Help:** a "?" button beside the status, the `?` key, and the first visit in a browser open "How to use the Map". It covers getting around, reading the Map, what each color means, the panel, Claude Code's activity and the keyboard.
- **The status** is a bordered button with a chevron, so it reads as the menu it opens.
- **Source:** a file's panel offers "View source", a read-only drawer over the canvas with line numbers. A declaration in the panel opens it at that declaration's lines, highlighted (API_CONTRACTS.md §16). A file over 200,000 characters is shown plain, with "Shown without colors: too large to color quickly.": coloring runs on the main thread, 55–70 ms for 200,000 characters of VS Code's TypeScript and about 350 ms for 1 MB *(2026-10-13)*.
- **Pages and Back:** a big folder is drawn a page at a time, 44 boxes that import each other, turned with the page pill in the canvas's top-right corner ("‹ Page 2 of 5 · 44 of 182 folders and files ›", 36 px buttons) or the arrow keys. *(Big solid arrows at the canvas's sides did it too until 2026-10-13, when a second critique found two ways to do one thing, and the owner saw the right arrow sitting on a box while the panel was open.)* Lines to boxes on other pages end at **portals**, dashed, unfilled doorway boxes in `--text-2` with an arrow toward their page, titled by where their lines go ("Lines to page 2", "44 folders and files · 6 imports", imports as a line's hover sentence counts them; past 6 linked pages, one "Lines to 12 more pages" box with a stack icon). *(Until 2026-10-13 they were filled like a folder and titled "Page 2", the page pill's own words, which a second critique found confusing on a box.)* Double-clicking a portal turns to its page, and its panel lists the boxes on this page linked to it. The address bar holds the folder and page, so the browser's Back returns to the previous one (ADR-042). A link that names a place another way (`?path=src%2Fvs`, `?page=1`) or a page past the last (`?page=9` of 3) is rewritten to the place drawn rather than pushed, so Back always takes one press; Back also wins over a jump still loading. A jump that fails (a search hit or chip whose path the index no longer has) says so over the Map until the Map moves, or for 6 s, and a doorway that an index update took away stops being selected *(2026-10-13, the deferred minors)*.
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
  - A page pill in the canvas's top-right corner ("‹ Page 1 of 3 · 44 of 112 folders and files ›") replaces the top bar's note, and the side arrows are solid light buttons (removed later the same day; the pill's buttons do the job). (A first try put a 15 px bar at the bottom of the canvas; the owner found it loud and, in the boxes' colour, camouflaged.)
  - The repo's name goes to the top level (its ▾ switches repos).
  - Hovering a box shows its one-line summary.
  - Search drops the repo's own name when other words remain.

  **Not changed:** knowing to start in `src` takes programming knowledge; the hover summaries are the in-scope help. Folder names already count in search since the owner's own try at task 1 the same day (ADR-027, amended).
- The owner signs off visually before merging.

## 10. Narrow windows (2026-10-24)

The owner, on the Map in VS Code's panel at about 415 px wide: "FIX ALL compression issues in the entire project so no matter how miuch i compress it u can still see the stuff. this can include adding a horizontal scroll bar, etc. etc. make sure no ui breaks either". The panel was cut off on its left (a fixed 400 px pinned to the right of a narrower area), and the top bar's search, help and status sat on each other. ADR-064 records the decision.

**The rule.** At any window size, down to 200 × 260, everything the Map shows stays reachable and readable: nothing is cut off out of reach, no control sits on another, and no text is clipped without a way to read it (an ellipsis and the whole text in a hover title). Surfaces adapt first; sideways and downward scrolling is the floor.

**Normal sizes are unchanged, but for one state.** At 1100 × 700 and up nothing below applies, and every state the layout check walks, at 1440 × 900 and 1100 × 800, gives a screenshot byte-identical to the one taken before the change, except the error banner while the details panel is open. That banner used to run under the panel and the page pill; it now keeps to the canvas beside the panel and clear of the pill (below). With no panel open, the banner is byte-identical to before.

**The floor: 360 × 320** (`MIN_WIDTH`, `MIN_HEIGHT` in `app/map/narrow.ts`). Below it the Map keeps that size and the page scrolls, with the theme's thin scrollbars (§7). 360 px holds the top bar's essentials and a canvas as wide as the floor; 320 px leaves a 200 px canvas under the three bars (48 + 40 + 32 px), which stacks a paged level's pill over the zoom controls with about 20 px between them. The Map fills the body's column rather than `100dvh`, so a sideways scrollbar doesn't add a downward scroll of its own height. VS Code's bottom panel is often shorter than 320 px; there the page scrolls down.

**What gives way, in order, as the window narrows:**

| Surface | Under 1100 px | Under 900 | Under 768 | Under 640 | Under 520 | Under 440 |
|---|---|---|---|---|---|---|
| Top bar | "Dependency map" goes | | the search's Ctrl K hint goes (sooner if the field can't hold it and its words whole) | the search becomes an icon beside the help | the status pill keeps its dot (title and menu say the rest) | the "Nebulosity" name goes, the mark stays |
| Breadcrumb row | | | the busy folder's note keeps only its toggle ("Show all lines"; its title says the rest) | | | |
| Activity bar | | the oldest of the 3 actions goes; the newest keeps the room it needs, the other what's left | | the second goes | the time and the "Claude Code" word go (the dot's title keeps it) | |

"Dependency map" goes under 1100 px rather than 900 so that it always goes first: in free mode the status pill reads "Summaries off (no API key)", about 90 px longer than "Up to date", and under 1100 the search's words would otherwise be cut while it still showed.

Between the steps: the search's words truncate first (and go once only a sliver would be left), then the status pill's words and the repo's owner, and the repo's own name last ("micro… vscode"), each whole in its title. The newest action's title lists the older ones with their times. The highlights' count and Clear always stay.

**Measured, not by breakpoint:**
- **The details panel** is 400 px beside the canvas while that leaves 360 px of canvas. With less, it covers the whole canvas (its × brings the canvas back), and the legend, the zoom controls and the page pill under it are hidden, and its boxes can't be reached by Tab.
  - **There, a click only selects** (owner review, 2026-10-25). In VS Code's panel the panel over the whole canvas hid the box a double click was aimed at, so folders couldn't be opened, and every editor follow covered the Map.
  - The selected box now shows its actions beside it, at screen size whatever the zoom: Open (a folder), "Go to page N" (a doorway) and Details. They sit under the box when its middle is in the canvas's top half, clear of the page pill's band, and over it lower down, clear of the legend and the zoom controls. They're centred on the box but kept 8 px inside the canvas's sides, so a box hanging off an edge doesn't take them past it (narrow.ts's `actionsSide` and `actionsPlace`).
  - Details opens the panel over the canvas. Its ×, or Escape, comes back to the Map with the box still selected.
  - A window narrowed while the panel is open beside the canvas keeps it, now over the canvas.
  - The layout check walks the actions as a state of their own (`actions`), and asks for Details in every state with a panel. The page pill and the zoom controls move left by the panel's width, never a fixed 400. Chips are at most 360 px or the panel's width; every row truncates with its title, and a long identifier or path in a summary breaks anywhere rather than run past the panel's edge. In a window under 480 px tall the whole panel scrolls, its header too, so the body isn't left a few lines.
- **The breadcrumb** truncates from its start: the first steps fold into one "…", which goes up to the last of them and names them all in its title, so the current folder always shows. It's measured before the new trail is painted, so the whole trail never shows for a frame.
- **The page pill** says "Page 2 of 5 · 44 of 182 folders and files" on a canvas 440 px or wider, "Page 2 of 5" from 240 px, "2 / 5" below, with the whole note as its title when shortened.
- **The legend** is at most as tall as the canvas allows: it stops below the pill's band on a paged level, and 8 px under the error banner; its rows scroll inside.
- **The repo list and the status menu** open where they always did, moved in only as far as it takes to keep 16 px from the Map's sides, narrowed only when the Map is narrower than they are, and no taller than the Map leaves above the activity bar. They're placed again if the window resizes while one is open (VS Code's panel dragged).

**The error banner** (a failed jump, a level that wouldn't load) takes no clicks in any form, so it never stands between the pointer and what's under it.
- **At normal sizes it's where it always was:** 24 px down, in the page pill's band, centred. It's now centred over the canvas beside the panel rather than the whole Map, so it no longer runs under an open panel. It keeps the pill's width clear, moving left of centre and then wrapping rather than touch the pill.
- **Where that band can't hold it in two lines** (a narrow canvas, a long message), it's a solid card in the canvas's top-left corner, clear of the pill and of the zoom controls. The open legend stops short of whichever form shows.
- **Over a panel that covers the canvas** it's the panel's last row, pinned to its bottom, so it never hides the end of the panel's list.

**Overlays in the page's body** are fixed to the window, outside the floor's scroll, so each fits the window itself, and while one is open the page under it doesn't scroll. The help narrows and scrolls: under 360 px its padding tightens and its keyboard list puts each key above what it does. Search is at most 92% of the window, its results truncating with titles and scrolling; the list never runs below the window, since a note (free mode, the demo) or an error shortens it. The source viewer takes the whole width under 600 px, its header wraps, and long lines scroll inside the code. The loading note and the empty state wrap with side padding.

**The check.** `npm run check-layout -- http://127.0.0.1:<port>` (`scripts/check-layout.mjs`, plain Node and headless Chrome; it refuses port 3000, and the Map must be showing the VS Code demo repo) walks 18 states at 20 sizes from 1440 × 900 to 200 × 260:
- the top level, a deep folder, a paged level and a busy folder;
- a file, a folder and the source root selected, and a summary with a 51-character name in inline code;
- the source viewer, search, help, both popovers and the legend;
- the activity bar with three tool calls and highlights;
- a failed jump's banner with the panel open, with nothing selected, and over the open legend.

Then it resizes one tab live through 11 sizes with a file's panel and the repo list open. It fails on:
- anything cut off out of reach;
- a control covered at its centre or at an edge's middle (hit-tested with React Flow's pane where a person can leave it);
- clipped text without an ellipsis and a title, text running out of its box, or text cut to a lone "…";
- text on text, or text on a control it isn't part of;
- a page that scrolls at a normal size or past the floor;
- a console error.

`--shots <dir>` saves screenshots.
