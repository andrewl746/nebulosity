# Demo video script

The owner's script to record from (D9). Not a spec: change the wording freely, but keep the two prompts exactly as written.

## Goal and length

About 2 minutes, at most 2:30. It is for someone who has never heard of Nebulosity: what it is, that it works on a repo as big as VS Code, and that it makes Claude Code's dependency answers cheaper and faster on that repo.

## Setup checklist

- [ ] The Map running (`npm run dev`) on VS Code, with the index current.
- [ ] Claude Code registered in `../vscode` with live events **on**, for this recording only.
- [ ] A browser window at 1920 × 1080, zoom 100%, no bookmarks bar, no other tabs.
- [ ] A terminal with a neutral prompt (PowerShell: `function prompt { "PS> " }`).
- [ ] Claude Code's header shows its working folder (`C:\Users\…`), so start recording after it scrolls away, or crop it.
- [ ] Check the first and last frames for any `C:\Users` path before publishing.
- [ ] No `.env.local`, Anthropic console or API key ever on screen.

## Shot list

| Time | On screen | Narration | Action |
|---|---|---|---|
| 0:00–0:10 | VS Code's top level on the Map | "VS Code is 20,000 files. Claude Code searches it on demand; Nebulosity has already mapped it." | Hold on the top level, then start to zoom in. |
| 0:10–0:45 | The Map | Say what each step shows: folders as boxes, lines for imports, pages and doorways for big folders, the panel's summary and "Used by", search by meaning. | Open `src`, then `src/vs/platform` (pages and doorways). Click `src/vs/base/common/lifecycle.ts` (panel: summary, Used by). Press Ctrl K and type "terminal". |
| 0:45–1:35 | Claude Code beside the Map | Say that Claude Code now asks the Map's engine instead of grepping, and the Map follows along. | Type prompt 1, then prompt 2 (below). |
| 1:35–1:50 | The eval's headline table from `docs/EVAL_RESULTS.md`: arm B (Nebulosity at Claude Code's default, tools deferred) against arm A (baseline) | State the headline result in one sentence, then: "On big-picture questions it scored lower, 0.82 against 0.91, and it raised accuracy on none of the three kinds of question." | Show the table, then the loss. |
| 1:50–2:00 | The demo link and the repo URL on screen | "Try it on VS Code in your browser, or point it at your own repo." | Hold. |

### Prompts (type these verbatim)

Prompt 1 (0:45–1:10), expect `imports` (with `transitive`) with exact totals; boxes pulse; `show_on_map` highlights:

```
What depends on src/vs/base/common/lifecycle.ts, and how many files is that? Show me the biggest areas on the map.
```

Prompt 2 (1:10–1:35), expect `imports` with `to`; the Map moves to it:

```
How does src/vs/workbench/workbench.desktop.main.ts end up loading the terminal's terminalInstance.ts?
```

They are not eval questions: CN1 asks something similar, so the video answers it live rather than reusing an eval transcript.

## Recording notes

- 1080p at 30 fps, the cursor highlighted.
- The narration can be recorded separately if that is easier.
- Captions burned in, or as a file.
