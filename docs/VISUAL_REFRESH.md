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

| Token | Hex | One meaning |
|---|---|---|
| `--canvas` | `#111318` | page and Map background, a single flat charcoal |
| `--surface` | `#1B1D24` | boxes, inputs, cards |
| `--panel` | `#16181F` | the details panel |
| `--hairline` | `#262933` | dividers |
| `--border` | `#3A3E4A` | box and input borders |
| `--text` | `#F0F1F5` | primary text |
| `--text-2` | `#B1B5C0` | secondary text, counts, labels |
| `--neutral-edge` | `#4A4F5C` | ordinary connections |
| `--select` | `#B58AFF` | **purple: the selected box, its direct links and its dependency path.** Nothing else |
| `--select-fill` | `#241D33` | the selected box's fill |
| `--agent` | `#F08A4B` | **orange: what Claude Code is touching right now.** Nothing else |
| `--ok` | `#4CC38A` | **green: indexing status only** (the "indexed" dot) |

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

## 7. System rules (anti-noise)

- **One radius:** 8 px for boxes, cards and inputs; 6 px for chips.
- **A small type scale:** 18 / 15 / 14 / 13 / 12 px, in two weights (400 and 500). Sans everywhere; monospace only for code identifiers and paths inside text.
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
