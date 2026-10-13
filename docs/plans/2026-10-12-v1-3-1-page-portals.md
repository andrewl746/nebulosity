# V1.3.1 Page Portals and Smart Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (inline) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Continue the existing ledger at `.superpowers/sdd/2026-10-12-v1-3-1-visual-refresh/progress.md`: add a `Plan B: …` heading line, then the usual `Task N: complete` and `Ruling:` lines.

**Goal:** Every box of a big folder is drawn on some page, with no "+N more" box. Pages group boxes that import each other, and the imports that do cross pages show as **portals**: doorway boxes to the other pages that lines run into.

**Why (the owner's review, 2026-10-12).** The first paging build sliced a folder by size. Each page drew 49 boxes and folded every other box into a "+N more" box ("Boxes 99–112 of 112", "+98 more"). The owner found two faults:
- the point of pages is to show every box;
- boxes on different pages import each other, so a page can't be an island.

The owner picked option **A (page portals) plus smart pages** from a mockup of three ideas (badges and a page strip were the others).

**Architecture:** two pure functions in `lib/engine/pages.ts`, unit-tested with hand-derived vectors, replace `foldNodes` for folders with more than 50 children:
- `assignPages` puts children on pages, growing each page by strongest import attachment.
- `buildPageView` makes one page's boxes, its portals, and its lines, including the lines folded onto portals.

`level()` uses them; `foldEdges`'s idea (fold the ends you don't draw, add up lines that land together) carries over. The UI adds a portal look, portal interactions, and a page note. A `?focus=` parameter lets search and the panel open the page holding a box.

**Tech stack:** as V1.3.1 (Next 16, React 19, React Flow 12.11, Vitest 4). No new dependency.

**Spec:** `docs/VISUAL_REFRESH.md` (§4, §9) and ADR-041. This plan amends the paging added in the owner's review, recorded in the V1.3.1 ledger, `docs/API_CONTRACTS.md` §11 and `PIVOT_SPEC.md` §7 "Cap".

## Global Constraints

- **S4 holds: at most 50 boxes per page.** `PAGE_SIZE = 44` boxes plus at most `MAX_PORTALS = 6` portals (44 + 6 = 50). A folder with ≤ 50 children is one page, with no portals and nothing folded (unchanged).
- **Deterministic.** The same children and lines always give the same pages and the same picture. Ties break by the Map's order (largest first, then more-imported, then path, ADR-036).
- **Paths.** A portal's path is `<level>//page-<n>` (n counted from 1), and a merged portal's is `<level>//pages`. The root's are `//page-<n>` and `//pages`. Stored paths never hold `//`, so they can't collide.
- **Contract.** `MapNodeKind` swaps `"more"` for `"portal"`, a breaking change, so `CONTRACTS_VERSION` goes 2 → 3 (ADR-040). Update `API_CONTRACTS.md` §11 and `lib/contracts.ts` in the same commit.
- **All the V1.3.1 rules still hold:**
  - tokens only, with no raw colors (the guard test);
  - the UI imports only types from `lib/`;
  - test-first, with expectations derived by hand;
  - `npx tsc --noEmit && npm run lint && npx vitest run` clean before each commit;
  - commit and push to `origin pivot/v1` after each task, with the owner as the only author (never a `Co-Authored-By` or any Claude attribution);
  - never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`.
- **Browser checks.** The desktop app's browser pane gets no animation frames while hidden. Ask the owner to show it (Ctrl+Shift+B) for anything frame-based (S3, screenshots). DOM checks work without frames. Don't send `npm run live` events while the owner has Map tabs open: they broadcast to every tab.

## Review Focus

1. **A folder with no lines at all** (a leaf of 780 generated files) pages by size, exactly as before, and has no portals.
2. **A page linked to more than 6 other pages** merges the extra pages into one `+N pages` portal, so S4 holds.
3. **A line between two boxes on other pages** (neither end drawn) is dropped, not drawn portal-to-portal.
4. **Search to a box on page 3** opens page 3 with the box selected (`?focus=`), not page 1.
5. **Back and reload** keep working with pages: the URL still carries `page`, and pages are stable for a given index version.

## Ground truth (hand-derived; the tests transcribe these)

**The example folder `x`.** Children in the Map's order: `x/a`, `x/b`, `x/c`, `x/d`, `x/e`, `x/f` (files, `fileCount` 1 each). Lines (source → target, count):

| Line | Count |
|---|---|
| `a → c` | 4 |
| `c → e` | 2 |
| `b → d` | 3 |
| `d → f` | 1 |
| `e → b` | 1 |

**Assigning pages, with `pageSize` 3.** Weights are undirected: the two directions of a pair add up.
- **Page 1.** It seeds with the first unassigned box in the Map's order, `a`. The unassigned box joined most strongly to the page is `c` (4), so the page is `{a, c}`. Next, joined to `{a, c}`: `e` via `c–e` (2), giving `{a, c, e}`, which is full.
- **Page 2.** It seeds with `b`. Then `d` (3), giving `{b, d}`. Then `f` via `d–f` (1), giving `{b, d, f}`, which is full.
- **Result:** `[[a, c, e], [b, d, f]]` in the Map's order within a page. `e → b` is the only line that crosses.
- **The rule when nothing joins.** When no unassigned box joins the page, the next unassigned box in the Map's order goes in. So a folder with no lines pages exactly by size.
- **The contrast.** Size slicing would have made `{a, b, c}` and `{d, e, f}`, which crosses `c → e`, `b → d` and `e → b`: 3 lines with weight 6.

**Page 0's view** (with `maxPortals` 6):
- nodes `x/a`, `x/c`, `x/e`, plus the portal `{ path: "x//page-2", name: "Page 2", kind: "portal", page: 1, fileCount: 3, hiddenCount: 3, summaryStatus: "skipped" }`;
- lines `a → c` (4), `c → e` (2), and `e → x//page-2` (1): `e` imports `b`, which is on page 2.

**Page 1's view:**
- nodes `x/b`, `x/d`, `x/f`, plus the portal `x//page-1` (`page: 0`, name "Page 1");
- lines `b → d` (3), `d → f` (1), and `x//page-1 → b` (1).

**Merging portals.** Take `maxPortals` 2 and 4 pages, where page 0 has links to page 1 (5 links), page 2 (1 link) and page 3 (3 links).
- The page keeps a portal of its own for `maxPortals − 1 = 1` page: the most-linked, page 1 (ties go to the lower page).
- The rest merge into `{ path: "<level>//pages", name: "+2 pages", kind: "portal", pages: [2, 3] }`, with `fileCount` and `hiddenCount` added up over both pages.
- Lines to pages 2 and 3 fold onto it and add up (4 links).

**A page with no links to another page** gets no portal for it. The page arrows and the page note still reach every page.

## File map

| File | Change |
|---|---|
| `lib/engine/pages.ts` (new) | `PAGE_SIZE = 44`, `MAX_PORTALS = 6`, `portalPath(level, page)`, `assignPages`, `buildPageView` |
| `lib/engine/pages.test.ts` (new) | the vectors above |
| `lib/engine/level.ts` | `level()` pages through `assignPages` and `buildPageView` for > 50 children; a `focus` option picks the page holding a path; `foldNodes` and `foldEdges` retire, or stay only if something else uses them (check `boxFor`, describe and the bench) |
| `lib/engine/level.test.ts` | the paging tests move to the new rules (the old `foldNodes` page vectors go) |
| `lib/contracts.ts`, `docs/API_CONTRACTS.md` §11 | `MapNodeKind` gets `"portal"` instead of `"more"`; `MapNode.page?`, `MapNode.pages?`; `CONTRACTS_VERSION = 3` |
| `app/api/level/route.ts`, `app/map/api.ts` | an optional `focus` parameter |
| `app/map/MapBox.tsx` | the portal look: dashed `border-text-2`, `IconArrowLeft` for a lower page, `IconArrowRight` for a higher one, `IconStack2` for merged; the name "Page 2", and "44 boxes · 6 links" under it |
| `app/map/MapCanvas.tsx` | double-clicking a portal turns to its page (merged: selects it); single click selects it, like any box |
| `app/map/DetailPanel.tsx` | a portal's panel replaces `FoldedList` (below) |
| `app/map/MapView.tsx` | `PageNote` reads "Page 2 of 5 · 44 of 182 boxes"; `focus()` passes `focus` to the level fetch; turning pages via a portal goes through `turnPage` (history, ←/→ unchanged) |
| `app/map/paths.ts` | `boxFor`: a path on another page lands on that page's portal (or the merged one); its test gets vectors |
| `app/map/emphasis.ts` | nothing should change (portals are boxes); confirm with a test vector |
| `app/map/HelpDialog.tsx`, `docs/VISUAL_REFRESH.md` §4, `docs/PIVOT_SPEC.md` §7, `docs/ENGINEERING_DECISIONS.md` | the copy and the docs (Task 5) |

## Tasks

### Task 1: `assignPages` and `buildPageView` (pure, engine)

**Interfaces:**
```ts
export const PAGE_SIZE = 44;
export const MAX_PORTALS = 6;
export const portalPath = (levelPath: string, page: number): string => `${levelPath}//page-${page + 1}`;
export const mergedPortalPath = (levelPath: string): string => `${levelPath}//pages`;
/** Pages of child paths, each in the Map's order; children come in the Map's order. */
export function assignPages(children: readonly MapNode[], edges: readonly MapEdge[], pageSize?: number): string[][];
export function buildPageView(levelPath: string, children: readonly MapNode[], edges: readonly MapEdge[], pages: readonly string[][], page: number, maxPortals?: number): { nodes: MapNode[]; edges: MapEdge[] };
```
- [ ] Write the tests from the ground truth: both views, the merge, the no-lines folder, and dropping a line whose two ends are both on other pages.
- [ ] Watch them fail, implement, and watch them pass.
- [ ] The greedy step must be efficient enough for 780 children (keep a running attachment weight per unassigned box). Add a timing test: 780 children and 2,000 random-but-seeded lines assign in < 50 ms.
- [ ] Commit `feat(engine): smart pages and portals for big folders (pure)`.

### Task 2: `level()` uses them; contract v3; `focus`

- [ ] **Tests first.** Fixture levels are unchanged (≤ 50 children). A synthetic case through `assignPages`/`buildPageView` is already covered. Add `level(root, "src", { focus: "src/core/log.ts" })` → page 0 of 1. If the fixture can't reach > 50, cover `focus` in a pure helper `pageOf(pages, path)`.
- [ ] **The engine.** In `level()`: if children > `MAP_BOX_CAP`, then `pages = assignPages(...)`, `page = focus ? pageOf(...) : clamp(page)`, and `view = buildPageView(...)`. `hiddenCount` = boxes on other pages.
- [ ] **The contract.** `MapNodeKind`, `MapNode.page?`/`pages?`, `CONTRACTS_VERSION = 3`, API_CONTRACTS §11 (pages, portals, `focus`, errors).
- [ ] **The route.** Parse `focus` with `parseRepoPath` (400 on a bad one).
- [ ] **The client.** `api.level(path, page, signal, focus?)`.
- [ ] `npm run bench-map -- ../vscode`: "most boxes on any level" ≤ 50 (S4), and the level p95 stays ~1 ms. Note the numbers for BENCHMARKS.
- [ ] Commit `feat(engine): big folders page by connection, with portals; contract v3`.

### Task 3: The UI (portal boxes, portal panel, page note, focus)

- [ ] **`boxFor` vectors first** (paths.test): a path on another page → its portal; a page merged away → the merged portal.
- [ ] **MapBox:** the portal look (see the file map).
- [ ] **MapCanvas:** a portal's double click → `onTurnPage(node.data.box.page)`; merged → select it.
- [ ] **DetailPanel**, for a portal:
  - kind "Page", name "Page 2", "44 boxes · 6 links with this page";
  - a "Go to page 2" button;
  - "Linked from this page": the boxes on this page with lines to it, each with its count, from the level's lines, clickable to select;
  - for a merged portal, the list of its pages, each a button.
- [ ] **MapView:** `PageNote`, `focus` on search, panel chips and `focus_node` (the level fetch gets `focus`; when the answer's page differs from the place's, replace the place's page without a history push); the arrows and ←/→ unchanged.
- [ ] **HelpDialog:** "Big folders are split into pages of related boxes. Lines to other pages end at a page's doorway; double-click it to go there."
- [ ] **Browser checks** (dev server on port 3001; `.claude/launch.json` has `nebulosity-dev-3001`):
  - `?path=src/vs/platform` (112 children, 3 pages): no "+N more", portals with link counts, double-clicking a portal turns the page, selecting a box with a cross-page line turns the portal's line purple;
  - `?path=src/vscode-dts` (182, 5 pages);
  - `?path=src/vs/platform/agentHost/node/codex/protocol/generated/v2` (780, a merged portal);
  - Ctrl K for a file on page 3 opens page 3 with it selected;
  - Back walks pages; every page's lines draw.
- [ ] Commit `feat(map): page portals and pages of related boxes (owner review)`.

### Task 4: The second code review (fresh eyes)

- [ ] Dispatch a reviewer (the most capable model; the superpowers `code-reviewer.md` template) on `0647a27..HEAD`: everything since the first whole-branch review. That covers routed lines, Back, paging and portals, the help, the source endpoint, syntax highlighting and the theme.
- [ ] Focus: the `/api/source` security rules (indexed files only, realpath inside the repo, the 1 MB cap), the portal and page math, React effects (history, the focus clock, lazy imports), and `dangerouslySetInnerHTML` (escaped by highlight.js).
- [ ] Re-grade by effect. Fix Critical and Important test-first in one pass, and ledger the minors.

### Task 5: Close out V1.3.1 (the old plan's Task 11, still owed)

- [ ] `npm run build`. Stop whatever holds port 3000 first (the owner's `npm start` may be running; ask before stopping it).
- [ ] Start `nebulosity-prod`, then ask the owner to show the pane.
- [ ] **S3 walk** (the old plan's Task 11 step 2; a script sketch lives in the old session's scratchpad, so rewrite it if missing): ≥ 15 level changes, 10 box clicks, 10 `src` panel opens, 20 wheel zoom steps, read from `window.__nebulosityPerf`. Pass bars: S3 p95 ≤ 100 ms per interaction; the `src` panel ≤ 300 ms warm.
- [ ] **Screenshots** at 1440 × 900: the root, a selection with its panel, a drilled-in level, and a paged level with portals. They go in `docs/screenshots/v1-3-1/`.
- [ ] **Docs:**
  - BENCHMARKS "2026 10 12 Map Benchmark #2" (the old profile table from the old plan, the bench-map lines, the browser S3 table);
  - ADR-042: the owner-review additions (routed lines, pages with smart grouping and portals, Back and URL, the source viewer's indexed-only rule, help, the violet-slate theme and syntax colors), plus a note on ADR-040's v3 bump;
  - VISUAL_REFRESH: the status line, and a list of the amendments since approval;
  - the roadmap V1.3.1 row (done) and CLAUDE.md's current state.
- [ ] Commit and push. **Stop for the owner's sign-off.** Then open the PR `pivot/v1 → main`:
  - title "V1.3.1 Visual refresh: violet slate Map, routed lines, pages with portals, source viewer";
  - a body with what changed, the S3 table, the screenshots, the three-task test as owed (unless the owner did it), and the deferred minors from the ledger;
  - **no Claude attribution anywhere.** The owner merges.

## Deferred, already known (list them in the PR, don't fix them here)

- Hover state survives a level change.
- `splitSummary` stops splitting after a stray backtick.
- Some truncated labels have no `title` (breadcrumb steps, owner/repo, search hit paths).
- The legend can cover a corner box after a fit.
- Each hover rebuilds every box and line object (watch it in the S3 walk).
