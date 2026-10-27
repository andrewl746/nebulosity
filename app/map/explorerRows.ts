import type { LevelResponse, MapNode } from "@/lib/contracts";
import { formatCount } from "./format";
import { maxFilesOf } from "./weights";

/**
 * What the explorer lists (the Workbench redesign, ADR-070): the boxes of the level on screen as rows, folders first by
 * how many files they hold, then the files by name, each folder with a bar for its size. Doorways to other pages are
 * boxes on the Map but not rows, since they stand for boxes rather than being any. A folder drawn a page at a time says
 * which page this is. Pure, so the order and the scale are tested alone (explorer.test.ts).
 */

/** A folder's bar, 3 px for the smallest up to 36 px, its column's width, for the page's largest. */
export const BAR_MIN = 3;
export const BAR_MAX = 36;

/**
 * A folder's bar on the same log scale as its dot on the Map (weights.ts's dotSize), so VS Code's src (10,280 files)
 * and a folder of 4 both show: 36 × log10(files + 1) / log10(largest + 1). Never under 3 px, so an empty folder still
 * has a mark, and never past its 36 px column.
 */
export function barWidth(files: number, maxFiles: number): number {
    if (maxFiles <= 0) return BAR_MIN;
    const width = (BAR_MAX * Math.log10(Math.max(0, files) + 1)) / Math.log10(maxFiles + 1);
    return Math.min(BAR_MAX, Math.max(BAR_MIN, width));
}

/**
 * One row. A folder's carries its files, its bar's width in px, and what a screen reader says for it, "src, 10,280
 * files", since the count alone has no unit. A file's is its name.
 */
export type ExplorerRow =
    | { kind: "folder"; path: string; name: string; files: number; bar: number; label: string }
    | { kind: "file"; path: string; name: string };

/** How a row is drawn: the selection, a box joined to it by a drawn line, or neither. */
export type RowTone = "selected" | "linked" | "plain";

export function rowTone(path: string, selected: string | null, linked: ReadonlySet<string>): RowTone {
    if (path === selected) return "selected";
    return linked.has(path) ? "linked" : "plain";
}

/**
 * Names in the order VS Code's own explorer gives them, so the list reads the way the person already knows: case
 * mixed together and numbers by value (file2 before file10). Two names that differ only in case keep a fixed order.
 */
const COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const byName = (a: MapNode, b: MapNode): number => COLLATOR.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const files = (n: number): string => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;

/** The level's rows: folders by files, the largest first and ties by name, then the files by name. No doorways. */
export function explorerRows(nodes: readonly MapNode[]): ExplorerRow[] {
    const maxFiles = maxFilesOf(nodes);
    const folders = nodes.filter((n) => n.kind === "folder").sort((a, b) => b.fileCount - a.fileCount || byName(a, b));
    const loose = nodes.filter((n) => n.kind === "file").sort(byName);
    return [
        ...folders.map((n): ExplorerRow => ({
            kind: "folder", path: n.path, name: n.name, files: n.fileCount, bar: barWidth(n.fileCount, maxFiles), label: `${n.name}, ${files(n.fileCount)}`,
        })),
        ...loose.map((n): ExplorerRow => ({ kind: "file", path: n.path, name: n.name })),
    ];
}

/** The header's count of the rows, "13 items" or "1 item". */
export function itemCount(rows: number): string {
    return `${formatCount(rows)} ${rows === 1 ? "item" : "items"}`;
}

/**
 * The quiet line under a folder drawn a page at a time, "Page 2 of 5, 44 of 182 folders and files": which page, and how
 * many of the folder's boxes it draws (the rest are on the other pages). Null when the folder fits on one page.
 */
export function pageLine(level: Pick<LevelResponse, "page" | "pageCount" | "hiddenCount">, drawn: number): string | null {
    if (level.pageCount <= 1) return null;
    return `Page ${level.page + 1} of ${level.pageCount}, ${formatCount(drawn)} of ${formatCount(drawn + level.hiddenCount)} folders and files`;
}

export type ExplorerView = { rows: ExplorerRow[]; count: string; pageLine: string | null };

/** Everything the explorer draws for a level. */
export function explorerView(level: Pick<LevelResponse, "nodes" | "page" | "pageCount" | "hiddenCount">): ExplorerView {
    const rows = explorerRows(level.nodes);
    return { rows, count: itemCount(rows.length), pageLine: pageLine(level, rows.length) };
}
