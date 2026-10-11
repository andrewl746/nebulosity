import path from "path";

/** Windows backslashes → forward slashes, so every path compares equal everywhere. */
export function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/** The folder part of a repo-relative path ("" for a file at the repo root). */
export function dirOf(relPath: string): string {
    const slash = relPath.lastIndexOf("/");
    return slash === -1 ? "" : relPath.slice(0, slash);
}

/**
 * Joins a repo-relative directory with a relative path, collapsing "." and "..".
 * Returns null when the result would climb above the repo root: such an import
 * points outside the indexed tree, so it can never become an edge.
 */
export function joinRepoPath(baseDir: string, relative: string): string | null {
    const segments = baseDir === "" ? [] : baseDir.split("/");

    for (const part of normalizeSlashes(relative).split("/")){
        if (part === "" || part === ".") continue;

        if (part === ".."){
            if (segments.length === 0) return null;
            segments.pop();
        } else{
            segments.push(part);
        }
    }

    return segments.join("/");
}

/** One spelling of a repo root everywhere (repositories.rootPath): absolute, forward slashes. */
export function repoKey(repoRoot: string): string {
    return normalizeSlashes(path.resolve(repoRoot));
}
