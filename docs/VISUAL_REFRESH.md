# VISUAL_REFRESH.md — The Map's light, technical theme (slice V1.3.1)

**Status:** Approved by the owner, 2026-10-12, after five mockup rounds. This is the target the V1.3.1 build matches. Decision record: ADR-041.
**Replaces:** ADR-029's "the dark amethyst look stays" (dark background, starfield, purple glow).
**Scope:** visual only. Colors, type, borders, spacing and layout regions change. APIs, data, behavior and the 50-box cap don't.

## 1. Feel

A **light, bold, technical** look: white cards with thick dark outlines on a cool gray page, each section with its own deep color, and monospace for data. It should read like an engineering instrument: calm and cool overall, with **one warm accent that always means "what you selected"**.

## 2. Color tokens

Define these as CSS custom properties (`app/globals.css`). Components use the tokens, never raw hex.

| Token | Hex | Role |
|---|---|---|
| `--page` | `#E9ECEF` | page background (cool gray) |
| `--card` | `#FFFFFF` | card and box fill |
| `--ink` | `#1B2430` | text, outlines, edges, connector dots |
| `--ink-muted` | `#56606B` | secondary text, labels, counts |
| `--map` | `#2F4B7C` | navy: the Map section |
| `--select` | `#E0662A` | **signal orange**: the selected box plus the Details section. The only warm color |
| `--overview` | `#3F6E4E` | forest green: the Overview section |
| `--search` | `#3B6EA8` | steel blue: the Search section, plus "used by the selection" on the Map |
| `--claude` | `#5E4A9C` | violet: the Activity section, plus "Claude is looking" on the Map (a nod to the original amethyst) |

**The rule for meaning:** a color means the same thing wherever it appears. Orange is never decoration, only selection or Details.

**Contrast (WCAG AA):**
- On `--select` (orange), text uses `--ink`. White on that orange is about 3.2:1 and fails.
- On `--map`, `--claude` and `--search`, text is white (about 5:1 or better).
- Muted text never sits on a colored fill.

## 3. Shape

- **Cards:** `--card` fill, a `2px solid var(--ink)` border, `6px` radius, and `12–14px` padding. Behind each card sits an **offset layer**: a block the card's own section color, shifted `5px` right and `5px` down, with the same radius. It's flat, with no blur or shadow.
- **Map boxes:** `4px` radius, a `2px` `--ink` border (`2.5px` when selected), and white fill unless the box carries a meaning color.
- **Edges:** `2px` `--ink`, solid for imports, dashed `6 4` for weaker or indirect links. Connection points are **6 px square dots**, not circles.
- **Chips** (uses and used-by counts): a `2px` `--ink` border, `4px` radius, and monospace `12px` text.

## 4. Type

| Use | Size and weight | Font |
|---|---|---|
| App title | 20px / 500 | sans |
| Section titles (Map, Details, Overview, Search, Activity) | 15px / 500, with a Tabler outline icon in the section color | sans |
| Box name | 14px / 500 | sans |
| Body (summaries) | 14px / 400, line-height 1.55 | sans |
| Data: counts, paths, the repo name, chips | 12–13px | **monospace** |
| Labels and metadata | 13px / 400, `--ink-muted` | sans |

Everything is sentence case. There's no all-caps text.

## 5. Layout regions

From top to bottom:
1. **Top bar:** "Nebulosity" plus the repo in monospace on the left; status chips (indexed, summaries %) on the right.
2. **Main row:** the **Map** card (navy layer), wide, holding the breadcrumb in monospace, the canvas, and a legend for the three meaning colors. Next to it, the **Details** card (orange layer), about 210–260px wide, showing the name, tagline, summary, and "Uses" / "Used by" chips. It appears when something is selected.
3. **Bottom row:** three equal cards. **Overview** (green) has the file, import and folder counts. **Search** (steel blue) has the ⌘K entry field. **Activity** (violet) has the live Claude Code dock.

The starfield background and the purple glow effects are removed.

## 6. What doesn't change

Data flow, the API contracts, the 50-box cap and "+N more", edge aggregation, layout (dagre), live events, the performance budgets (S3 ≤ 100 ms on the production build) and all behavior. If a visual change threatens S3, the budget wins.

## 7. Acceptance

- Every token in §2 is defined once and used everywhere: there's no raw hex in components.
- Checked in the desktop app's browser pane on VS Code: each of the five sections is visually distinct, the selected box is orange with ink text, "Claude is looking" boxes pulse violet, and used-by boxes show steel blue.
- S3 is re-measured after the change and still ≤ 100 ms (production build).
- Screenshots of the root level and of a level with a selection are attached to the slice's PR.
- The owner signs off visually before the merge.
