import type { GitHubSource } from "./api";

export type LinkTarget = { repo: string; path: string };

/** A file in the user's editor, from the app (PIVOT_SPEC.md §7): needs the repo's absolute root, so never in the demo. */
export function editorLink(target: LinkTarget, line?: number): string {
    return `vscode://file/${target.repo}/${target.path}${line ? `:${line}` : ""}`;
}

/** A file on GitHub at the commit the demo's index was built from, at a declaration's lines (ADR-049). */
export function githubLink(source: GitHubSource, filePath: string, lines?: { start: number; end: number }): string {
    const anchor = lines === undefined ? "" : lines.start === lines.end ? `#L${lines.start}` : `#L${lines.start}-L${lines.end}`;
    return `https://github.com/${source.owner}/${source.name}/blob/${source.commit}/${filePath.split("/").map(encodeURIComponent).join("/")}${anchor}`;
}
