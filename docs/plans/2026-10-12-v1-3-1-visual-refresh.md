# V1.3.1 Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner chose inline execution) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Map readable at a glance, per `docs/VISUAL_REFRESH.md`: a flat charcoal canvas, larger and simpler boxes, one meaning per color, a structured and actionable details panel, a clearer top bar, and an always-visible activity bar. Also bundle the `describe` speed fix.

**Architecture:** This is presentation work inside `app/`. The color tokens live once in `app/globals.css`, and Tailwind exposes them as `bg-surface`, `text-text-2` and so on. The decisions about what to show go into small pure modules with their own tests: emphasis, activity, and the panel's text helpers. The components only render what those modules decide. The engine changes are two:
- a per-index-version answer cache in `describe()`;
- an optional `remote` (owner and name) on `RepoSummary`, read from the repo's `.git/config`.

**Tech Stack:** Next.js 16.2, React 19, React Flow 12.11, Tailwind 4, Vitest 4. **New dependency:** `@tabler/icons-react@3.47.0`, for the outline icons the spec names (`ti-folder`, `ti-file`). It's tree-shaken, so only the icons used ship.

**Spec:** `docs/VISUAL_REFRESH.md` (approved 2026-10-12) and ADR-041. Executors read both.

## What profiling found before planning (the §8 speed fix)

The spec says the `src` panel took about 5 s in V1.3. That doesn't reproduce on today's code:

| Where | `src` | Notes |
|---|---|---|
| `describe()` in process | 30–32 ms | stale-summary count 13 ms, line sum 8 ms, children 6 ms; area counts are already from the in-memory graph (0.0 ms warm) |
| `GET /api/describe` on the V1.3 production server | 48–82 ms | |
| Browser, click to panel with data, production | 53–141 ms | the pane was hidden, so timed with `setTimeout` polling, not `__nebulosityPerf` |
| Browser, click to panel with data, dev server | 233 ms first (includes the route compile), then 53–95 ms | |

Likely sources of the 5 s are a cold dev-server compile of `/api/describe`, or the on-demand summary refresh, which lands seconds after the panel opens and has no indicator. Neither is in `describe()`.

The fix, then:
- **Cache every answer per index version, as the spec asks.** Repeat opens cost about 0 ms of engine time.
- **Show "Refreshing…" while a summary refresh is in flight.**
- **Paginate the panel's contents.** The widest folder has 780 children: a 192 KB answer, built in 6 ms. That doesn't need an API change, so the contents get "View all" in the panel instead.
- **Re-measure in the browser pane on the production build.**

## Global Constraints

- **Colors.** Every color comes from a `VISUAL_REFRESH.md` §2 token. No raw hex, `rgb(`/`rgba(` or Tailwind palette colors (`zinc-`, `purple-`, `cyan-`, `amber-`, `red-`, `green-`) in `app/**/*.tsx`.
- **One meaning per color.** Purple (`--select`) is only the selection and its links. Orange (`--agent`) is only Claude Code's activity. Green (`--ok`) is only the indexed dot.
- **One addition, recorded in §2 in Task 2.** `--danger` (`#F07A7A`) is for error text and a failed stage. §2 has no error color, and errors need one.
- **Type and shape.** The type scale is 18 / 15 / 14 / 13 / 12 px, in weights 400 and 500. Nothing anyone reads is smaller than 12 px. Text is sans everywhere; monospace is only for code identifiers and paths.
  - Radius: 8 px for boxes, cards and inputs; 6 px for chips.
  - Spacing: 4 / 8 / 12 / 16 / 24 px.
- **No decoration.** No shadows, glows, gradients or `backdrop-blur`. The only motion is the agent pulse, and `prefers-reduced-motion` turns it off.
- **Layering.** The UI imports nothing from `lib/` except types (ARCHITECTURE.md §3). React Flow types stay in `app/map` (ADR-040).
- **Before every commit:** `npx tsc --noEmit && npm run lint && npx vitest run` are clean.
- **Git.** Commit with conventional prefixes and push to `origin pivot/v1` after each task.
  - The owner is the only author: never a `Co-Authored-By` line.
  - Stage only the files the task touched. Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`.
- **Test expectations are written by hand** from the vectors in this plan, never by running the code.

## Review Focus

1. **Long names and deep paths** (`extHostTerminalShellIntegration.ts`, `src/vs/platform/agentHost/node/codex/protocol/generated/v2`): boxes, chips and rows truncate with an ellipsis and keep the full path in `title`. Checked in the browser on that 780-child folder (Task 8).
2. **Selecting the "+N more" box**: the emphasis treats it like any box, and its lines go purple (Task 5 test). The panel lists the folded children (Task 8).
3. **Summary text that breaks naive parsing**: an unmatched backtick, periods inside code (`main.ts`), "e.g." and "i.e.", and decimals like "3.4" (Task 7 vectors).
4. **No live channel, or no tool calls yet**: the activity bar says so instead of showing nothing, and no box is outlined (Task 10 vectors and browser check).
5. **A repo with no GitHub-style origin**, or whose `.git` is a file (a worktree): the top bar falls back to the folder name (Task 9 vectors).

---

### Task 1: The plan, and the roadmap row

**Files:** Create `docs/plans/2026-10-12-v1-3-1-visual-refresh.md`. Modify `docs/IMPLEMENTATION_ROADMAP.md`: a V1.3.1 row under V1.3.
- [ ] Write both, commit `docs: V1.3.1 visual refresh plan`, and push.

### Task 2: Tokens and the quiet canvas

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `docs/VISUAL_REFRESH.md` (§2: add the `--danger` row)
- Delete: `app/components/StarField.tsx`
- Test: `app/theme.test.ts`

**Interfaces.** Produces the CSS custom properties from §2, plus `--danger`. Each one is mapped in `@theme inline` as `--color-<name>: var(--<name>)`, so components write `bg-canvas`, `bg-surface`, `bg-panel`, `border-hairline`, `border-border`, `text-text`, `text-text-2`, `stroke-neutral-edge`, `border-select`, `bg-select-fill`, `outline-agent`, `bg-ok` and `text-danger`. `--font-sans` maps to Geist and `--font-mono` to Geist Mono.

- [ ] **Step 1: The failing test.** `app/theme.test.ts` reads `app/globals.css` and checks that each token is defined exactly once (`/--name:\s*#hex;/`, case-insensitive) with these hex values, transcribed from §2: `canvas #111318`, `surface #1B1D24`, `panel #16181F`, `hairline #262933`, `border #3A3E4A`, `text #F0F1F5`, `text-2 #B1B5C0`, `neutral-edge #4A4F5C`, `select #B58AFF`, `select-fill #241D33`, `agent #F08A4B`, `ok #4CC38A`, `danger #F07A7A`. Each one is also mapped in `@theme inline`.
- [ ] **Step 2:** `npx vitest run app/theme.test.ts`. It fails: the tokens are missing.
- [ ] **Step 3:** Write the tokens.
  - `body` gets the canvas background, the `--text` color and the Geist sans font.
  - React Flow's variables are pointed at the tokens: `--xy-controls-button-*`, `--xy-edge-label-*` and `--xy-background-color`.
  - The `neb-pulse` keyframes become a 2 px `--agent` outline that grows from 0 to 8 px offset and fades over 0.9 s, under `@media (prefers-reduced-motion: reduce) { animation: none }`.
  - `page.tsx` is a flat `bg-canvas` with no haze layers and no StarField.
  - The layout metadata description becomes "A code-intelligence companion for massive codebases".
- [ ] **Step 4:** The test passes, and so do tsc, lint and the full suite.
- [ ] **Step 5:** Commit `feat(map): the refresh's color tokens and a flat canvas (V1.3.1)` and push.

### Task 3: `describe()` answers are cached per index version (the §8 speed fix)

**Files:**
- Modify: `lib/engine/describe.ts`, `scripts/bench-map.ts` (adds a warm pass)
- Docs: `docs/API_CONTRACTS.md` §12 (a note), `docs/ENGINEERING_DECISIONS.md` (amend ADR-036)
- Test: `lib/engine/describe.test.ts`

**Interfaces.** `describe(repoRoot, targetPath, options)` keeps its signature. The answer it returns is shared: callers treat it as read-only.

- [ ] **Step 1: The failing test**, added to `describe.test.ts`. It needs `sql` from drizzle-orm and `bumpIndexVersion`:
```ts
it("answers again from its cache until the index version moves (ADR-036, amended)", () => {
    const root = copyFixture();
    const { repoId } = indexRepository(root);
    const db = getDb();
    const first = describe(root, "src/core");
    // a write that skips the version bump (no real writer does): the cached answer still shows
    db.run(sql`update folders set file_count = 99 where repo_id = ${repoId} and path = 'src/core'`);
    expect(describe(root, "src/core")).toBe(first);
    bumpIndexVersion(db, repoId);
    expect(describe(root, "src/core").stats.fileCount).toBe(99);
});
```
- [ ] **Step 2:** It fails: the second call builds a new object.
- [ ] **Step 3: The implementation.** The current body moves, unchanged, into `describeUncached(db, repo, repoId, version, targetPath, summariesOff)`.
```ts
/** Answers kept per repo for one index version at a time; a new version empties them (PIVOT_SPEC.md §6.1). */
type CachedAnswers = { version: number; answers: Map<string, DescribeResponse> };
const answerCache = new Map<string, CachedAnswers>();
/** A bound on one version's answers, not an LRU: past it the map starts over (as cachedAreaCounts does). */
const MAX_CACHED_ANSWERS = 2_000;

export function describe(repoRoot: string, targetPath: string, options: MapReadOptions = {}): DescribeResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);
    const summariesOff = options.summariesOff ?? false;

    return db.transaction(() => {
        // every write the panel shows moves the version (ADR-036), so an answer holds until it moves; the repo's id is in
        // the key because a re-created repo starts counting again
        const version = readIndexVersion(db, repoId);
        const cacheKey = `${repoId}\0${repo}`;
        let cached = answerCache.get(cacheKey);
        if (!cached || cached.version !== version){
            cached = { version, answers: new Map() };
            answerCache.set(cacheKey, cached);
        }
        const key = `${summariesOff ? "off" : "on"}\0${targetPath}`;
        const hit = cached.answers.get(key);
        if (hit) return hit;

        const answer = describeUncached(db, repo, repoId, version, targetPath, summariesOff);
        if (cached.answers.size >= MAX_CACHED_ANSWERS) cached.answers.clear();
        cached.answers.set(key, answer);
        return answer;
    });
}
```
  A path with nothing indexed still throws, and a throw is never cached.
- [ ] **Step 4:** `bench-map` adds `describe(), every folder, again (cached)` with its p50, p95 and max.
- [ ] **Step 5:** The test passes, and the suite, tsc and lint are clean. Run `npm run bench-map -- ../vscode` and note the warm line for Task 11.
- [ ] **Step 6:** ADR-036 gets an amendment: the per-version answer cache, the profile table above, and what it found. API_CONTRACTS §12 notes that answers are cached per index version. Commit `perf(engine): describe answers are cached per index version (V1.3.1 speed fix)` and push.

### Task 4: Install the icons

- [ ] `npm install @tabler/icons-react@3.47.0 --save-exact`. Check that `import { IconFolder } from "@tabler/icons-react"` type-checks, and that `npm run build` doesn't grow the page's first-load JS by more than about 10 kB. Commit `chore: add @tabler/icons-react for the Map's outline icons` (package.json and package-lock.json only) and push.

### Task 5: What's emphasized (pure)

**Files:**
- Create: `app/map/emphasis.ts`, `app/map/emphasis.test.ts`
- Delete: `app/map/edges.ts` and `app/map/edges.test.ts`. §4 replaces the √count widths and the ghosting.

**Interfaces (produces):**
```ts
export type BoxTone = "normal" | "selected" | "linked" | "preview" | "faded";
export type EdgeTone = "normal" | "selected" | "preview" | "faded";
export const edgeKey = (edge: Pick<MapEdge, "source" | "target">): string => `${edge.source}->${edge.target}`;
export function mapEmphasis(
    boxes: readonly string[], edges: readonly MapEdge[], selected: string | null, hovered: string | null,
): { boxes: Map<string, BoxTone>; edges: Map<string, EdgeTone> };
```
**Rules:**
- A selection or hover that isn't one of `boxes` counts as none, and so does hovering the selected box.
- **Edges.** An edge that touches the selection is `selected`. Otherwise, one that touches the hover is `preview`. Otherwise it's `faded` when something is selected, and `normal` when nothing is.
- **Boxes.** The selected box is `selected`. A box joined to it by an edge is `linked`. Otherwise, the hovered box and boxes joined to it are `preview`. Everything else is `faded` when something is selected, and `normal` when nothing is.

**Vectors** (boxes a, b, c, d; edges a→b, b→c, d→c):

| selected | hovered | boxes a, b, c, d | edges a→b, b→c, d→c |
|---|---|---|---|
| null | null | normal ×4 | normal ×3 |
| b | null | linked, selected, linked, faded | selected, selected, faded |
| null | d | normal, normal, preview, preview | normal, normal, preview |
| b | d | linked, selected, linked, preview | selected, selected, preview |
| x (not a box) | null | normal ×4 | normal ×3 |
| b | b | as (b, null) | as (b, null) |

Plus "+N more": boxes `["src/a", "src/"]`, edge `src/a→src/`, selected `"src/"`, gives boxes linked, selected and edge selected.

- [ ] Write the tests and see them fail (the module doesn't exist). Implement, make them pass, then run tsc, lint and the suite. `MapCanvas` stops importing `edges.ts` in this task, temporarily mapping tones onto today's styles, so the build stays green. Commit `feat(map): emphasis from the selection and the hover (pure)` and push.

### Task 6: The canvas: boxes, lines, hover, controls, legend

**Files:** Modify `app/map/MapBox.tsx`, `app/map/MapCanvas.tsx`, `app/map/levelLayout.ts`, `app/map/levelLayout.test.ts` (the gap moves from 28 to 40), and `app/map/MapView.tsx`. Create `app/map/Legend.tsx`.

**Interfaces:**
- `BoxData = { box: MapNode; tone: BoxTone; agent: boolean; pulseKey: number }`
- `MapCanvas` props: `{ level, selected, agent: ReadonlySet<string>, pulses, onSelect, onOpen, onDrawn }`. `agent` replaces `highlighted`, and the hover state lives in `MapCanvas`. Wrapped in `memo`.
- `levelLayout`: `BOX_WIDTH = 232`, `BOX_HEIGHT = 64`, `GAP = 40`, `ranksep = 96`.

**Look:**
- **Box.** `bg-surface`, a 1 px `border-border`, `rounded-lg` (8 px), `px-3`. Line 1 is an `IconFolder`/`IconFile` (16 px, `text-text-2`) and the name (15 px / 500 `text-text`, truncated). Line 2 is "10,276 files" (12 px `text-text-2`), for folders and "+N more" only. A file box shows one line, vertically centered.
- **Tones.** `selected` is `bg-select-fill` with a 2 px `border-select`. `preview` is `border-text-2`. `faded` is `opacity-60`. `linked` and `normal` are the plain box.
- **"+N more".** A dashed border and `IconDots`.
- **Claude's focus.** `agent` draws `outline outline-2 outline-offset-2 outline-agent`, and `pulseKey` remounts the `neb-pulse` span.
- **Edges.** Every edge has `markerEnd: ArrowClosed` (12 px) in its tone's color:

  | Tone | Line |
  |---|---|
  | normal | 1 px `var(--neutral-edge)` |
  | selected | 2 px `var(--select)` |
  | preview | 1.5 px `var(--text-2)` |
  | faded | 1 px `var(--neutral-edge)` at opacity 0.35 |

  Hovering a line labels it "1,234 imports" (12 px, on a `--surface` label).
- **Hover.** `onNodeMouseEnter`/`Leave` set the hover.
- **Controls** (bottom right, tokens): zoom in, zoom out, fit view, and a `ControlButton` "Reset focus" (`IconFocusCentered`, `aria-label`) that calls `onSelect(null)` and clears the hover.
- **Fit.** `fitView({ padding: 0.15, maxZoom: 1 })`. No `Background` grid: §3 makes it optional.
- **`Legend`** (bottom left, 12 px `text-text-2`): "A → B: A imports B", a purple line "Selected and its links", and an orange square "Claude Code". This is §4's "label the relationship", done once instead of on every line.
- **`MapView`** passes `agent` = the show_on_map highlights (Task 10 adds recent tool calls). The breadcrumb row uses tokens.

**Acceptance (browser pane, dev server, VS Code):**
- At root, the boxes read at 100 % zoom.
- Clicking `src/vs` turns its lines purple and 2 px, and the unrelated boxes go to about 60 % opacity.
- Every line has an arrowhead.
- Hovering a box brightens its lines without selecting it.
- Double click opens a folder, and the breadcrumb goes back.
- "Reset focus" clears the selection and the fade.
- `getComputedStyle` on a selected box gives `rgb(181, 138, 255)` borders, and `opacity: 0.6` on a faded one.
- `npm run live -- describe src/vs --highlight` outlines `src` in orange.

- [ ] Implement it, check it in the pane, then run tsc, lint and the suite. Commit `feat(map): larger quiet boxes, directional lines, hover preview and reset focus (V1.3.1)` and push.

### Task 7: The panel's text helpers (pure)

**Files:**
- Create: `app/map/text.ts`, `app/map/text.test.ts`
- Modify: `app/map/format.ts` and `format.test.ts` (`formatCompact`), `app/map/paths.ts` and `paths.test.ts` (`shortPath`)

**Interfaces (produces):**
```ts
export type TextPart = { text: string; code: boolean };
export function inlineCode(text: string): TextPart[];                 // text.ts
export function splitSummary(summary: string): { lead: string; rest: string };   // text.ts
export function formatCompact(n: number): string;                     // format.ts
export function shortPath(targetPath: string): string;                // paths.ts: the last two segments
```

**Rules:**
- **`inlineCode`.** A pair of backticks around one or more non-backtick characters is code. Anything else stays literal, unmatched or empty backticks included, and empty parts are dropped.
- **`splitSummary`.** The lead is the first sentence. A sentence ends at `.`, `!` or `?` outside backticks, followed by whitespace and then `[A-Z0-9"'(“‘]`. It doesn't end when the word before the stop is `e.g`, `i.e`, `etc`, `vs` or `cf`. Both halves are trimmed.
- **`formatCompact`.** Below 1,000 it prints the exact number. Otherwise it picks K, M or B by magnitude and rounds to one decimal. A rounded 1,000 moves up a unit, and a trailing ".0" is dropped.

**Vectors:**

| Call | Expected |
|---|---|
| `inlineCode("Uses \`vs/base\` heavily")` | `[{ "Uses ", false }, { "vs/base", true }, { " heavily", false }]` |
| `inlineCode("no code")` | `[{ "no code", false }]` |
| `inlineCode("\`a\`\`b\`")` | `[{ "a", true }, { "b", true }]` |
| `inlineCode("an odd \` backtick")` | `[{ "an odd \` backtick", false }]` |
| `inlineCode("a \`\` b")` | `[{ "a \`\` b", false }]` |
| `inlineCode("\`x\` and \`y\` and \` z")` | `[{ "x", true }, { " and ", false }, { "y", true }, { " and \` z", false }]` |
| `inlineCode("")` | `[]` |
| `splitSummary("One. Two three.")` | `{ lead: "One.", rest: "Two three." }` |
| `splitSummary("Single sentence only.")` | `{ "Single sentence only.", "" }` |
| `splitSummary("Holds \`main.ts\` and \`cli.ts\`. Then more.")` | `{ "Holds \`main.ts\` and \`cli.ts\`.", "Then more." }` |
| `splitSummary("Uses helpers, e.g. \`foo\`, to log. Second.")` | `{ "Uses helpers, e.g. \`foo\`, to log.", "Second." }` |
| `splitSummary("Wraps APIs (i.e. Node and Electron). Next sentence.")` | `{ "Wraps APIs (i.e. Node and Electron).", "Next sentence." }` |
| `splitSummary("Version 3.4 ships. More.")` | `{ "Version 3.4 ships.", "More." }` |
| `splitSummary("A period inside \`code. Like this\` stays. Next.")` | `{ "A period inside \`code. Like this\` stays.", "Next." }` |
| `splitSummary("Ends with a question? Yes it does.")` | `{ "Ends with a question?", "Yes it does." }` |
| `splitSummary("One.\n\nTwo.")` | `{ "One.", "Two." }` |
| `splitSummary("")` | `{ "", "" }` |
| `formatCompact` | 0 → "0"; 999 → "999"; 1,000 → "1K"; 1,234 → "1.2K"; 12,345 → "12.3K"; 999,949 → "999.9K"; 999,950 → "1M"; 3,395,641 → "3.4M"; 10,000,000 → "10M"; 1,250,000,000 → "1.3B" |
| `shortPath` | `"src/vs/platform/files/common"` → `"files/common"`; `"build"` → `"build"`; `"src/vs"` → `"src/vs"`; `""` → `""` |

- [ ] Write the tests and see them fail. Implement, make them pass, then run tsc, lint and the suite. Commit `feat(map): inline code, summary leads and compact counts for the panel (pure)` and push.

### Task 8: The details panel (§5)

**Files:** Modify `app/map/DetailPanel.tsx`.

**Interfaces.** The props are unchanged: `{ path, level, indexVersion, onFocus, onOpen, onClose }`.

**Layout, top to bottom.** The panel is 400 px wide, `bg-panel` with a `border-l border-hairline`, in sans:
1. **Kind:** "Repository", "Folder", "File" or "Folded boxes", in 12 px `text-text-2`. The close button is an `IconX`.
2. **Name:** 18 px / 500, with the path under it in 12 px mono `text-text-2`.
3. **Stats.** A folder shows "10,276 files · 3.4M lines" (`formatCount` · `formatCompact`); a file shows "1,234 lines". After that come "· N changed since summarized" when there are any, then "Open folder" (button) or "Open in VS Code" (link). Both links are `text-text` underlined, never purple.
4. **Summary.** The tagline (15 px / 500), then the lead (14 px, line-height 1.5), both through `inlineCode` (the code is 13 px mono on a `bg-surface rounded-md px-1` chip). "Read full summary" reveals the rest, split into paragraphs at blank lines.
   - **Notes:** stale, "Refreshing…" while `api.summarize` is in flight, failed with "Try again" (`text-danger`), and the existing test-count note for files.
5. **Relationships.** "Depends on" (`uses`) and "Used by" (`usedBy`, noted "includes test files") as chips: `rounded-md border-border bg-surface`, 13 px, `shortPath · count`, with the full path in `title`. Up to 8 chips, then a "+N more" chip that shows them all. A chip calls `onFocus(path)`. When there are none, the existing empty sentences.
6. **Contents.** For a folder or repo, its children: an icon, the name, and the file count for folders. The first 8 show, "View all N" pages 20 at a time, a folder row calls `onOpen`, and a file row calls `onFocus`. For a file, "Declarations" (name, kind, line; a `vscode://` link), paged the same way.
7. **Folded boxes** (a "+N more" selection) uses the same rows.

**Acceptance (browser pane):**
- The `src` panel shows "10,276 files · 3.4M lines" and inline-code chips, and no literal backticks (`get_page_text` finds none in the summary).
- "Read full summary" expands.
- The `build` chip under Used by focuses `build` at the root.
- A child folder row opens it, and a file row selects it.
- In `…/generated/v2` (780 children), "View all" pages, and long names truncate with a `title`.

- [ ] Implement it, check it in the pane, then run tsc, lint and the suite. Commit `feat(map): a structured, actionable details panel (V1.3.1)` and push.

### Task 9: `owner / repo` from the origin remote (engine and contract)

**Files:**
- Create: `lib/engine/git-remote.ts`, `lib/engine/git-remote.test.ts`
- Modify: `lib/engine/repos.ts`, `lib/contracts.ts` (`RepoSummary.remote?`), `docs/API_CONTRACTS.md` §15

**Interfaces (produces):**
```ts
export type RepoRemote = { owner: string; name: string };           // contracts.ts; RepoSummary gains `remote?: RepoRemote`
export function originUrl(gitConfig: string): string | null;        // git-remote.ts: [remote "origin"]'s url
export function remoteOwnerAndName(url: string): RepoRemote | null; // git-remote.ts
export function readRepoRemote(root: string): RepoRemote | null;    // git-remote.ts: reads <root>/.git/config; null when .git isn't a folder or there's no origin
```

**Vectors:**
- **`originUrl`:**
  - on `../vscode`'s config (as captured in this plan's research): `"https://github.com/microsoft/vscode.git"`
  - with no origin section: `null`
  - with an origin section but no url: `null`
  - with `[remote "upstream"] url = https://x/y/z.git` then `[remote "origin"]\n\turl = git@github.com:me/fork.git`: `"git@github.com:me/fork.git"`
- **`remoteOwnerAndName`:**
  - `https://github.com/microsoft/vscode.git` and `https://github.com/microsoft/vscode` → `{ microsoft, vscode }`
  - `git@github.com:andrewl746/Nebulosity.git` → `{ andrewl746, Nebulosity }`
  - `ssh://git@github.com/owner/repo.git` → `{ owner, repo }`
  - `https://gitlab.com/group/sub/repo.git` → `{ "group/sub", "repo" }`
  - `https://github.com/a/b/` → `{ a, b }`
  - `C:/repos/mirror`, `../other`, `https://github.com/` and `https://github.com/onlyowner` → `null`
- **`readRepoRemote`:**
  - on a temp folder whose `.git/config` holds the vscode config: `{ microsoft, vscode }`
  - on one whose `.git` is a file: `null`

- [ ] Write the tests and see them fail. Implement, make them pass, then run tsc, lint and the suite. The addition is optional, so `CONTRACTS_VERSION` stays 2 (ADR-040). Commit `feat(engine): repos carry their origin's owner and name for the top bar` and push.

### Task 10: The top bar, breadcrumb, status, search, and activity bar

**Files:**
- Create: `app/map/activity.ts`, `app/map/activity.test.ts`, `app/map/ActivityBar.tsx`
- Delete: `app/map/LiveDock.tsx`
- Modify: `app/map/TopBar.tsx`, `RepoMenu.tsx`, `Breadcrumb.tsx`, `StatusPill.tsx`, `SearchPalette.tsx`, `useLive.ts`, `MapView.tsx`, and `docs/VISUAL_REFRESH.md` (§6: the verb table below)

**Interfaces (produces):**
```ts
export const ACTIVITY_SIZE = 3;
export const AGENT_ACTIVE_MS = 30_000;   // the old dock's idle window
export function pushActivity(recent: readonly LiveEvent[], event: LiveEvent, size?: number): LiveEvent[];  // newest first
export function activityLabel(event: LiveEvent): string;
export function agentFocus(level: Pick<LevelResponse, "path" | "nodes">, recent: readonly LiveEvent[], highlights: readonly string[], now: number): Set<string>;
// useLive(onEvent) now returns { recent: LiveEvent[]; connected: boolean }
```

**Vectors:**
- **`pushActivity`:** `[]` plus e1 gives `[e1]`; `[e3, e2, e1]` plus e4 gives `[e4, e3, e2]`.
- **`activityLabel`.** A leading `mcp__nebulosity__` is dropped. `list` is the first path plus " +N" when there are more, and `""` reads "the repo".

  | Event | Label |
  |---|---|
  | `describe ["build/gulpfile.js"]` | "Reading build/gulpfile.js" |
  | `mcp__nebulosity__describe ["src/vs"]` | "Reading src/vs" |
  | `describe [""]` | "Reading the repo" |
  | `overview []` | "Reading the repo overview" |
  | `search ["a.ts", "b.ts", "c.ts"]` | "Searching · a.ts +2" |
  | `search []` | "Searching" |
  | `dependents ["x.ts"]` | "Finding what uses x.ts" |
  | `dependencies ["src/vs/editor"]` | "Finding what src/vs/editor uses" |
  | `path ["a.ts", "b.ts"]` | "Tracing a.ts → b.ts" |
  | `show_on_map ["src/vs", "src/main.ts"]` | "Showing src/vs +1 on the map" |
  | `grep_files ["x"]` | "grep_files · x" |
  | `grep_files []` | "grep_files" |

- **`agentFocus`.** Level `src`, with boxes `src/vs`, `src/main.ts` and `src/` (+N more).

  | recent (age at `now`) | highlights | Focus |
  |---|---|---|
  | `[describe ["src/vs/base/x.ts"] at now−1 s]` | none | `{src/vs}` |
  | the same event at now−31 s | none | `{}` |
  | none | `["src/typings/a.d.ts"]` (folded) | `{src/}` |
  | `[describe ["build/x.js"]]` | none | `{}` (outside the level) |

**Look:**
- **Top bar** (`h-12`, `border-b border-hairline`, `bg-canvas`), left to right:
  - the mark (`/icon.svg` at 18 px) and "Nebulosity" (14 px / 500);
  - `RepoMenu` as `owner / repo` (15 px: the owner `text-text-2`, the repo `text-text` 500), falling back to the folder name, with a caret when there's more than one repo;
  - "Dependency map" (13 px `text-text-2`);
  - a wide search field (`flex-1 max-w-xl`, 8 px radius, `bg-surface border-border`): `IconSearch`, "Search files and concepts", and `Ctrl K` / `⌘K`;
  - the status on the right: a dot plus a 12 px `text-text-2` line. The dot is `bg-ok` when everything is up to date, `bg-text-2` when busy, off or not indexed, and `bg-danger` when failed, with no pulse.
- **The status menu and search palette** use tokens. Their copy changes to "Search files and concepts", and the active row is `bg-surface`.
- **The breadcrumb** reads `vscode / src / vs` (14 px; every step but the last is a `text-text-2` button).
- **`ActivityBar`** (`h-8`, `border-t border-hairline`, `bg-panel`, always rendered, `data-testid="activity-bar"`):
  - on the left, "Claude Code" with a connection dot (`bg-text-2`, or hollow when not connected);
  - then up to 3 actions, newest first: an `--agent` dot, the label (13 px; the newest `text-text`, older `text-text-2`, truncated) and the age (12 px `text-text-2`);
  - an empty state of "No tool calls yet" or "Not connected".
- **`MapView`.** `agent = agentFocus(level, live.recent, highlights, now)`, with `now` ticking every second only while a recent action is younger than `AGENT_ACTIVE_MS`. It's memoized on its sorted contents, so the canvas doesn't redraw every second.

**Acceptance (browser pane).** Run `npm run live -- describe build/gulpfile.js`, then `search src/vs/base/common/lifecycle.ts`, then `dependents src/vs/editor`, then `describe src/vs`.
- The bar lists the last 3, newest first, each with an orange dot.
- `src` and `build` at the root are outlined in orange and pulse once on each new touch.
- After 30 s the outline clears, and the bar keeps the list.
- The top bar shows `microsoft / vscode`.

- [ ] Write the `activity.ts` tests and see them fail. Implement, make them pass, then build the components and check them in the pane. Run tsc, lint and the suite. Commit `feat(map): top bar, breadcrumb and an always-visible activity bar of Claude's last 3 actions (V1.3.1)` and push.

### Task 11: Verify, measure, document

**Files:**
- Create: `app/no-raw-colors.test.ts`, `docs/screenshots/v1-3-1/*.png`
- Modify: `docs/BENCHMARKS.md`, `docs/VISUAL_REFRESH.md` (status line, amendments), `docs/PIVOT_SPEC.md` §7 (the Look, Boxes, Edges and Live bullets point to VISUAL_REFRESH.md), `docs/ENGINEERING_DECISIONS.md` (an ADR-041 implementation note), `docs/IMPLEMENTATION_ROADMAP.md` (the V1.3.1 row status), `CLAUDE.md` (current state)

- [ ] **Step 1: The guard test**, written to find violations first: every `app/**/*.tsx` file matches neither `/#[0-9a-fA-F]{3,8}\b/`, `/rgba?\(/` nor `/\b(zinc|purple|cyan|amber|red|green)-\d{2,3}\b/`. Run it, fix any hits, and it passes.
- [ ] **Step 2: Production build.** `npm run build`, then a `nebulosity-prod` launch config (`npm run start`, port 3000), opened in the pane.
  - **The pane must be showing:** rAF is throttled to about 2 fps while it's hidden, which breaks `__nebulosityPerf`. Ask the owner to show it with Ctrl+Shift+B.
  - **The walk is V1.3's:** a warm-up pass, then 15 level changes (root → `src` → `vs` → `workbench` → `contrib` → `chat`, back up with Backspace, `src/vs/platform`, `src/vs/editor`, `common`), 10 box clicks, 20 wheel zoom steps timed by frame interval, and 10 `src` panel opens, all read from `window.__nebulosityPerf`.
  - **Pass bars:** S3 ≤ 100 ms p95 per interaction; `src` panel ≤ 300 ms warm.
- [ ] **Step 3: Screenshots** at 1440 × 900: the root, `src/vs` selected (with the panel), and the drilled-in `src/vs/workbench`. Save them to `docs/screenshots/v1-3-1/` and send them to the owner.
- [ ] **Step 4: Docs.**
  - **BENCHMARKS.md:** "2026 10 12 Map Benchmark #2" with the profile table, the warm describe line and the browser S3 table.
  - **VISUAL_REFRESH.md:** the status becomes "Implemented 2026-10-12, awaiting the owner's visual sign-off", and an amendments list (`--danger`, the legend, the activity verbs, the `owner / repo` source, the √count widths dropped, the describe findings).
  - **The three-task test** with an unfamiliar user is listed as still owed: the owner runs it.
- [ ] **Step 5:** Run tsc, lint and the suite. Commit `docs: V1.3.1 measured (S3 on the production build, src panel) and screenshots` and push. **Stop for the owner's visual sign-off.** Don't merge to `main`.
