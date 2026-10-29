# Map levels

Seven of VS Code's levels, as `GET /api/level` returns them, for `app/map/routes.test.ts`. They come from a free index (no summaries) of `../vscode` at commit `cc3fec88`, with each box's tagline dropped. Each file keeps the level's `path`, `page`, `pageCount`, `nodes` and `edges`, and the tests lay them out with `layoutLevel` as the Map does.

| File | Level | Boxes | Lines |
|---|---|---|---|
| `root.json` | the root | 13 | 11 |
| `vs.json` | `src/vs` | 10 | 31 |
| `editor.json` | `src/vs/editor` | 9 | 20 |
| `basetest.json` | `src/vs/base/test/common`, page 1 of 3, with doorways | 46 | 50 |
| `feedback.json` | `src/vs/sessions/contrib/agentFeedback/browser` | 22 | 52 |
| `agenthost.json` | `src/vs/platform/agentHost/node`, page 1 of 4, a busy level | 47 | 338 |
| `oss.json` | `build/azure-pipelines/oss`, where two trunks cross | 11 | 13 |
