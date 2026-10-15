# Architecture

The layers are `src/base`, `src/platform`, `src/editor` and `src/app`, each using only the ones before it.
Code in `src/platform` must not import `src/editor`.

Environment folders: `common`, `browser` and `node`. The text model lives in `src/editor/common`, and views in `editor/browser`.
