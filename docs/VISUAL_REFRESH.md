# VISUAL_REFRESH.md — Refining the Map's dark theme for readability (slice V1.3.1)

**Status:** Approved by the owner, 2026-10-12. This is the target the V1.3.1 build matches. Decision record: ADR-041.
**Replaces:** the V1.3 look: starfield, purple haze, glowing edges, tiny monospace boxes. An earlier same-day draft of this doc proposed a light theme; it was dropped before implementation.
**Scope:** presentation and interaction on the existing Map. The engine, the APIs (apart from the describe speed fix in §8), data, the 50-box cap and the level model are unchanged.

## 1. Principle

Optimize for **understanding a repo in 1–2 seconds per box**, not for looking futuristic.
- Make the important information prominent and the decorative information disappear.
- Every color means exactly one thing.
- The interface should feel predictable and intentional, like Linear, Vercel or GitHub, not like a generated dashboard.

This slice is shaped by what the owner saw on the real V1.3 screen: competing background effects, 9–10 px box text with a description in every box, purple used everywhere, and a details panel that was one dense monospace paragraph showing literal backticks and taking about 5 s to open for `src`.

## 2. Color tokens

Define these as CSS custom properties in `app/globals.css`. Components use tokens, never raw hex.

*(Revised 2026-10-12 by the owner's pick after the first build, which read as too monotone: cool slate surfaces (option C) with blue for titles and code (option B). The first table's grays are replaced, and the blue and body-text tokens are new.)*

| Token | Hex | One meaning |
|---|---|---|
| `--canvas` | `#0F131A` | page and Map background, a single flat cool slate |
| `--surface` | `#1A212C` | boxes, inputs, cards |
| `--panel` | `#141A23` | the details panel, drawers, dialogs |
| `--hairline` | `#232B38` | dividers |
| `--border` | `#3A4659` | box and input borders |
| `--text` | `#EEF2F8` | primary text: names, headings |
| `--text-body` | `#C3CBD8` | paragraphs: summaries, help |
| `--text-2` | `#AEB8C8` | secondary text, counts, labels |
| `--title` | `#9CC4FF` | **blue: a description's title** (a summary's tagline, help headings) |
| `--code` | `#A9CBFF` | **blue: code identifiers in text** |
| `--code-bg` | `#1B2940` | the chip behind them |
| `--folder` | `#7FB2F0` | **blue: the folder icon**, so folders and files part at a glance |
| `--neutral-edge` | `#5A6680` | ordinary connections, bright enough to follow on the slate |
| `--select` | `#B58AFF` | **purple: the selected box, its direct links and its dependency path.** Nothing else |
| `--select-fill` | `#251E36` | the selected box's fill |
| `--agent` | `#F08A4B` | **orange: what Claude Code is touching right now.** Nothing else |
| `--ok` | `#4CC38A` | **green: indexing status only** (the "indexed" dot) |
| `--danger` | `#F07A7A` | error text and a failed stage. *(Added in the V1.3.1 build: the table had no color for errors, and people need to see them.)* |

Blue is for names and code: what you read to know what something is. It never marks state; purple, orange and green keep those.

Purple is never used just because something is interactive. Links and buttons use `--text` with an underline or border, not purple.

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
- **Pages and Back:** a big folder is drawn 49 boxes at a time, with big arrows at the canvas's sides (or the arrow keys). The address bar holds the folder and page, so the browser's Back returns to the previous one.
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
- The owner signs off visually before merging.
