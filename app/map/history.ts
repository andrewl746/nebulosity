/**
 * The Map's place in the address bar: `/?path=src/vs&page=2`. Every move to another folder or page goes into the
 * browser's history, so Back returns to the previous folder (owner review), and a reload or a pasted link opens the
 * same place. The page is counted from 1 for people and from 0 inside the app; the slashes of a path stay readable.
 */
export type MapPlace = { path: string; page: number };

const encodePath = (folderPath: string): string => encodeURIComponent(folderPath).replaceAll("%2F", "/");

/**
 * The address for a place. Inside the editor's panel (`embedded`) it ends with `embed=vscode`, so a reload, a restarted
 * server or Next's own reload stays embedded and keeps the bridge (V1.8 plan P8); the browser Map never has the flag.
 */
export function mapUrl(folderPath: string, page: number, embedded = false): string {
    const params = [
        ...(folderPath === "" ? [] : [`path=${encodePath(folderPath)}`]),
        ...(page > 0 ? [`page=${page + 1}`] : []),
        ...(embedded ? ["embed=vscode"] : []),
    ];
    return params.length === 0 ? "/" : `/?${params.join("&")}`;
}

/** The place a query string names; anything it can't read is the first page of the root. */
export function placeFromSearch(search: string): MapPlace {
    const params = new URLSearchParams(search);
    const page = params.get("page") ?? "";
    return { path: params.get("path") ?? "", page: /^\d+$/.test(page) && Number(page) >= 1 ? Number(page) - 1 : 0 };
}

/**
 * What the address bar needs when the Map moves to `place`: nothing when it already says so; a rewrite when it names the
 * same place another way (`?path=src%2Fvs`, `?page=1`, `?path=`), so Back doesn't stop at a step that goes nowhere; and
 * a new history entry for a move to another place. `address` is the path and query string, `/?path=src`. `embedded`
 * (see `mapUrl`) makes an address without `embed=vscode` one to rewrite, so the flag is not lost.
 */
export function historyStep(address: string, place: MapPlace, embedded = false): "none" | "replace" | "push" {
    if (address === mapUrl(place.path, place.page, embedded)) return "none";
    const query = address.includes("?") ? address.slice(address.indexOf("?")) : "";
    const named = placeFromSearch(query);
    return named.path === place.path && named.page === place.page ? "replace" : "push";
}

/**
 * A move the editor asked for with `follow` (the active editor changed) changes the Map's place but must not fill Back
 * with a step per file the person clicked through: a push becomes a rewrite of the current entry. A `show` (a deliberate
 * jump) keeps `mode` "push". Everything else is as `historyStep` said.
 */
export function followStep(step: "none" | "replace" | "push", mode: "push" | "replace"): "none" | "replace" | "push" {
    return step === "push" && mode === "replace" ? "replace" : step;
}

/**
 * How many of the Map's own steps lie behind a history entry: the `mapDepth` the Map writes into `history.state` with
 * each push (and keeps with each rewrite). VS Code's panel has no browser Back, so the Map's own Back control is enabled
 * only above 0: going back past the Map's first entry would take the webview off the Map (owner review, 2026-10-25).
 * An entry the Map didn't write, a fresh load's or another page's, is 0, and so is anything that isn't a whole number.
 */
export function historyDepth(state: unknown): number {
    const depth = typeof state === "object" && state !== null ? (state as { mapDepth?: unknown }).mapDepth : undefined;
    return typeof depth === "number" && Number.isInteger(depth) && depth > 0 ? depth : 0;
}
