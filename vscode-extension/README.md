**Nebulosity for VS Code needs the `nebulosity` package, which serves the Map: [install it first](https://github.com/andrewl746/Nebulosity#install).** The extension is a window onto `nebulosity map`, not a copy of the engine.

The Nebulosity Map in an editor panel beside your code: your repo one folder at a time, with lines for imports, a panel with what each file uses and what uses it, and Claude Code's activity on it as it works. The Map follows the file you're in, and a file you pick on the Map opens in the editor.

Everything here works in Nebulosity's free mode, with no API key. The extension never writes summaries and never asks for a key.

## Getting started

1. Install the package (`npm install -g nebulosity`, or from a checkout as [its README](https://github.com/andrewl746/Nebulosity#install) says).
2. Open your repo in VS Code and run **Nebulosity: Show Map** from the Command Palette, or click the map button in an editor's title bar.
3. If the repo isn't indexed yet, the panel offers **Index this repo (free)**, which runs `nebulosity index` in a terminal and then shows the Map.

The extension uses a Map that's already running, on the port `nebulosity map` last used. If none is running, it starts one ("Starting the Map…"), and it stops the Map it started when its window closes. A Map you started yourself is never stopped by it.

## Commands

| Command | Where | What it does |
|---|---|---|
| Nebulosity: Show Map | Command Palette, editor title bar | Opens the Map beside the editor, starting it if needed, on this workspace's repo |
| Nebulosity: Show this file on the Map | Command Palette, editor and Explorer context menus | Moves the Map to the file and selects it |
| Nebulosity: What depends on this file? | Command Palette, editor and Explorer context menus | Lists the files that import it, lights them on the Map, and opens the one you pick; "Show all, including indirect" adds the files that import it through others |
| Nebulosity: Follow editor | The Map panel's title bar | Turns following the active editor off or on, for this window |
| Nebulosity: Index this repo | Command Palette, the not-indexed panel | Indexes the workspace's repo, free |
| Nebulosity: Stop Map | Command Palette | Stops the Map this window started |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `nebulosity.command` | empty | The `nebulosity` command to run: the installed command's path, or a checkout's `bin/nebulosity.mjs` (run with `node`). Empty finds `nebulosity` on your PATH. |
| `nebulosity.port` | empty | The Map's port. Empty uses the port the Map was last started on (`nebulosity map --print-port`), else 3000. |
| `nebulosity.followEditor` | `true` | Whether the Map follows the active editor when a window opens. The title-bar button changes it for one window and never edits your settings. |

## Good to know

- **One Map, one repo at a time.** Two windows on two repos share the Map, and the window you last focused shows its repo.
- **What the panel says when it can't show the Map:** "Nebulosity isn't installed" (with the install line), "The Map stopped" (with Start), "Update Nebulosity: `npm install -g nebulosity`" (a Map older than the extension), or that another app holds the port (set `nebulosity.port`). "Show log" opens the Nebulosity output.
- **Only VS Code can frame the Map.** The Map's pages allow only themselves and VS Code's webviews as frames, so another web page can't put the Map in a frame.
- **Checked on** desktop VS Code on Windows, macOS and Linux (VS Code 1.143), and on 1.105, the oldest version it supports, on Windows.

## Not yet

- **Browser-hosted VS Code** (vscode.dev, GitHub Codespaces in the browser): the Map answers only on your own machine.
- **Remote windows** (WSL, Remote SSH, Dev Containers) aren't checked yet with this version.

## License

MIT. Source and docs: [github.com/andrewl746/Nebulosity](https://github.com/andrewl746/Nebulosity).
