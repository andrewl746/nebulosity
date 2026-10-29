import type { ImportsResponse } from "../../lib/contracts";
import { isObject } from "./guards";
import { relativeIn, samePath } from "./repoMatch";
import type { ServerCheck } from "./serverCheck";

/**
 * The pure rules of the editor sync (sync.ts; design §4.4–§4.5, V1.8 plan P5, P6, P16, P17): the `/api/imports` request
 * and how its answer is read, What depends' highlight, whether a file from the Map opens and in which column, the
 * messages, and when a `show` keeps the follow after `ready` off the Map. They take no part of VS Code's API, so the root
 * vitest runs them.
 */

/** A `highlight` carries at most this many paths (API_CONTRACTS §20, design §4.5). */
export const MAX_HIGHLIGHT = 50;

/** The item that re-asks What depends with the indirect importers too (design §4.5). */
export const SHOW_ALL_LABEL = "Show all, including indirect";

/**
 * The page What depends asks for, direct and with "Show all": §19's largest, so typing can reach the importers the title
 * counts (up to 500; pickNote says so past it).
 */
export const PICK_LIMIT = 500;

/**
 * The request for one page of a path's dependents (API_CONTRACTS §19). `direction` is left out (dependents is its
 * default), and so is any option not given, so the server's defaults apply (direct only, 50 a page).
 */
export function importsPath(query: { path: string; transitive?: boolean; limit?: number }): string {
    const params = new URLSearchParams({ path: query.path });
    if (query.transitive === true) params.set("transitive", "true");
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return `/api/imports?${params.toString()}`;
}

/** A 404 whose envelope says NOT_FOUND (API_CONTRACTS §1): the index has no such file. INDEX_EMPTY is another 404. */
export function isNotFound(status: number, body: unknown): boolean {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return status === 404 && code === "NOT_FOUND";
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * An answer of §19's shape, keeping only its fields, or null for anything else: the QuickPick reads every one of them,
 * and an answer that isn't one would throw there instead of saying so.
 */
export function readImports(body: unknown): ImportsResponse | null {
    if (!isObject(body) || typeof body.path !== "string" || typeof body.transitive !== "boolean") return null;
    if (body.kind !== "file" && body.kind !== "folder") return null;
    if (body.direction !== "dependents" && body.direction !== "dependencies") return null;
    if (!isCount(body.direct) || !isCount(body.total) || !isCount(body.offset) || !isCount(body.indexVersion)) return null;
    if (!Array.isArray(body.files)) return null;
    const files: ImportsResponse["files"] = [];
    for (const file of body.files as unknown[]){
        if (!isObject(file) || typeof file.path !== "string" || !isCount(file.distance)) return null;
        files.push({ path: file.path, distance: file.distance });
    }
    return {
        path: body.path,
        kind: body.kind,
        direction: body.direction,
        transitive: body.transitive,
        files,
        direct: body.direct,
        total: body.total,
        offset: body.offset,
        indexVersion: body.indexVersion,
    };
}

/** A file on disk: the one scheme the Map's files have (a remote extension host sees its workspace's files as `file` too). */
export function isFileUri(uri: { scheme: string }): boolean {
    return uri.scheme === "file";
}

/**
 * A document's path in the repo, or null outside it. Only a file on disk counts: a `git:` document (the HEAD side of a
 * diff, Timeline), a notebook cell or a pull request's review copy keeps the file's own path, and would otherwise be
 * followed or shown as if it were the file (Task 8 Review I1). The same rule as the extension's for workspace folders.
 */
export function repoPathOfUri(root: string, uri: { scheme: string; fsPath: string }, platform: NodeJS.Platform): string | null {
    return isFileUri(uri) ? relativeIn(root, uri.fsPath, platform) : null;
}

/** The files What depends lights on the Map: the ones listed, at most the first 50, nearest first. */
export function highlightOf(r: ImportsResponse): string[] {
    return r.files.slice(0, MAX_HIGHLIGHT).map((file) => file.path);
}

/**
 * Whether the pick offers "Show all": only on a direct answer, and only when some importer is indirect, which the
 * transitive page of one entry asked beside it (`limit=1`) tells by its total against its direct count. When that page
 * couldn't be asked (null), whenever something imports the file at all: Show all asks again, and says why if it fails.
 */
export function showAllOffered(direct: ImportsResponse, oneIndirect: ImportsResponse | null): boolean {
    if (direct.transitive) return false;
    // an indirect importer imports a direct one, so with no direct importer there's none of either
    return oneIndirect === null ? direct.total > 0 : oneIndirect.total > oneIndirect.direct;
}

/**
 * Where a new panel opens (Task 9 review, ruling 4): beside the active editor, so it never takes the code's column. With
 * nothing open, the editor area is one empty column, and VS Code puts a new panel into it whatever column is asked for
 * (mainThreadWebviewPanels' getTargetGroupFromShowOptions), where the next file opened would cover the Map. Then a
 * second column is made first (`split`) and the panel goes to column 2, leaving column 1 for the code. `beside` is
 * vscode.ViewColumn.Beside, passed in because this module doesn't import vscode.
 */
export function panelColumn(oneEmptyColumn: boolean, beside: number): { column: number; split: boolean } {
    return oneEmptyColumn ? { column: 2, split: true } : { column: beside, split: false };
}

/**
 * The column a file from the Map opens in (design §4.4): the most recent text editor's, so it lands among the code,
 * unless that column is the panel's own (or there was none). Then a column beside the panel, on the code's side: the
 * one to its left (the panel opens to the right of the code, or in column 2), or column 2 for a panel in column 1.
 * Never the panel's own, which the file would cover. A real column, not ViewColumn.Beside, which counts from the active
 * column and gives the panel's when the active one is to its left.
 */
export function openColumn(last: number | undefined, panel: number | undefined): number {
    if (last !== undefined && last !== panel) return last;
    if (panel === undefined) return 1;
    return panel === 1 ? 2 : panel - 1;
}

/**
 * Whether a file the Map asks to open opens (P17, Review Focus 4), from `GET /api/repos`' answer as classifyRepos reads it:
 * only while the Map's active repo is the root the panel was shown for. The Map's own repo menu, or another window on
 * focus, can switch it, and then a path both repos have (README.md, package.json) would open this workspace's file for
 * the other repo's box without a word. "unknown" for an answer that isn't a current Map's.
 */
export function openCheck(check: ServerCheck, shownRoot: string, platform: NodeJS.Platform): "open" | "otherRepo" | "unknown" {
    if (check.kind !== "current") return "unknown";
    const active = check.list.active;
    return active !== null && samePath(active, shownRoot, platform) ? "open" : "otherRepo";
}

/** Show this file and What depends for a file the index doesn't hold (P5). */
export function notIndexedText(path: string): string {
    return `\`${path}\` isn't in Nebulosity's index (new, ignored, or not a source file).`;
}

/** An open from the Map for a file this workspace doesn't have: the Map shows another repo (P17, Review Focus 4). */
export function otherRepoText(path: string): string {
    return `\`${path}\` isn't in this workspace's repo (the Map shows another one; run Show Map to switch back)`;
}

/**
 * Whether the follow after a `ready` goes ahead (P16, Plan Review I4). After a `ready` the extension follows the active
 * editor, since the Map's page is new; but a `show` posted to that page (Show this file, What depends) is what the user
 * asked the Map for, and the follow would move it off that file. So a show holds the follow off for the rest of its
 * page: through a second `ready` of the same page too (a warm Map answers the relay's first hello and then fires
 * `load`, and the relay says hello again). A follow posted since lets it through again, since the Map has gone to the
 * editor's file by then, and so does a new page the extension loads (a reload after a repo switch, P7). Pages are the
 * panel's numbers (MapPanel.page), one per page it renders.
 */
export class ShowHold {
    /** The page a show was posted to, while it holds. */
    private page: number | null = null;

    showPosted(page: number): void {
        this.page = page;
    }

    followPosted(): void {
        this.page = null;
    }

    /** At a `ready` from `page`: whether to follow the active editor. */
    followOnReady(page: number): boolean {
        return this.page !== page;
    }
}
