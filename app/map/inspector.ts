import type { DescribeResponse, LevelResponse, MapNode } from "@/lib/contracts";
import type { GitHubSource } from "./api";
import { formatCompact, formatCount } from "./format";
import { nameOf } from "./paths";

/**
 * The inspector's words and numbers (the Workbench redesign, 2026-10-27): pure, so DetailPanel's rules are tested on
 * their own. The owner's copy rule holds for everything here that reaches the screen, so no colons, semicolons or
 * middle dots, and commas where the old panel had " · ".
 */

/** The inspector's tabs: what it uses, what uses it, and what's inside (a folder's contents, a file's declarations). */
export type InspectorTab = "uses" | "usedBy" | "inside";

/**
 * The tab a panel opens on. Used by when anything uses the target, since that's what the arrows into the selected box
 * show, else Uses when it uses anything, else what's inside. A folder nothing links to opens on its contents.
 */
export function defaultTab(target: Pick<DescribeResponse, "uses" | "usedBy">): InspectorTab {
    if (target.usedBy.length > 0) return "usedBy";
    if (target.uses.length > 0) return "uses";
    return "inside";
}

/** A row's bar never gets narrower than this share of the row, in percent, so a count of 1 next to 665 still shows. */
export const MIN_BAR = 1.5;

/**
 * A row's bar, as a percent of the row's width: its count over the largest count in the same tab (the mockup's
 * `.irow .b`). The largest row's bar is the whole row.
 */
export function barWidth(count: number, largest: number): number {
    if (largest <= 0) return MIN_BAR;
    return Math.min(100, Math.max(MIN_BAR, (100 * count) / largest));
}

/** The largest count among a tab's rows (0 for none): every row's bar is measured against it. */
export function largestCount(rows: readonly { count: number }[]): number {
    return rows.reduce((most, row) => Math.max(most, row.count), 0);
}

type Kind = DescribeResponse["kind"];

/**
 * The target's kind before describe() answers, so the name doesn't gain its slash a moment after the panel opens: the
 * repo, the folder on screen, or a box on the level. Undefined when the level doesn't say (a path found by search).
 */
export function kindBeforeDescribe(targetPath: string, level: Pick<LevelResponse, "path" | "nodes">): Kind | undefined {
    if (targetPath === "") return "repo";
    if (targetPath === level.path) return "folder";
    const kind = level.nodes.find((n) => n.path === targetPath)?.kind;
    return kind === "folder" || kind === "file" ? kind : undefined;
}

/**
 * What the inspector calls its target: a folder's name with a trailing slash ("src/"), as the code font writes a
 * folder, the repo's own name, or a file's name. While the kind isn't known yet the name shows bare.
 */
export function inspectorName(targetPath: string, repoRoot: string, kind: Kind | undefined): string {
    const name = nameOf(targetPath, repoRoot);
    return kind === "folder" ? `${name}/` : name;
}

/**
 * The name's hover title: the whole path, which the name alone doesn't show (a folder's with its slash, the repo's
 * root). It always holds the name itself, so a name cut off with an ellipsis can be read in full (check-layout's (c)).
 */
export function inspectorTitle(targetPath: string, repoRoot: string, kind: Kind | undefined): string {
    if (targetPath === "") return repoRoot;
    return kind === "folder" ? `${targetPath}/` : targetPath;
}

/** The word for a count: "line" for 1, "lines" for any other. */
const word = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Under the name: "10,280 files, 3.5M lines", or a file's "120 lines", then what changed since it was summarized
 * ("10,280 files, 3.5M lines, 12 changed since summarized").
 */
export function sizeLine(target: Pick<DescribeResponse, "kind" | "stats" | "stalePaths">): string {
    const { fileCount, lineCount } = target.stats;
    const lines = `${formatCompact(lineCount)} ${word(lineCount, "line", "lines")}`;
    const size = target.kind === "file" ? lines : `${formatCount(fileCount)} ${word(fileCount, "file", "files")}, ${lines}`;
    return target.stalePaths > 0 ? `${size}, ${formatCount(target.stalePaths)} changed since summarized` : size;
}

/** A row's hover title in Uses and Used by: "src/vs/base, 12 imports". */
export function importsTitle(targetPath: string, count: number): string {
    return `${targetPath}, ${formatCount(count)} ${word(count, "import", "imports")}`;
}

/**
 * A Contents row's hover title: its path, a folder's file count, and its one-line summary on a line of its own
 * ("src/vs/base, 1,204 files", then "Shared utilities…").
 */
export function childTitle(child: Pick<MapNode, "path" | "kind" | "fileCount" | "tagline">): string {
    const where = child.kind === "folder" ? `${child.path}, ${formatCount(child.fileCount)} ${word(child.fileCount, "file", "files")}` : child.path;
    return child.tagline ? `${where}\n${child.tagline}` : where;
}

/** A declaration's place, right of its name: "function, line 272", the line as an editor writes it (no comma). */
export function declarationPlace(symbol: { kind: string; startLine: number }): string {
    return `${symbol.kind}, line ${symbol.startLine}`;
}

/**
 * A folder (or the repo, "") on GitHub at the commit the demo's index was built from (ADR-049). links.ts's githubLink
 * is a file's blob link, and a folder is a tree.
 */
export function githubFolderLink(source: GitHubSource, folderPath: string): string {
    const root = `https://github.com/${source.owner}/${source.name}/tree/${source.commit}`;
    return folderPath === "" ? root : `${root}/${folderPath.split("/").map(encodeURIComponent).join("/")}`;
}
