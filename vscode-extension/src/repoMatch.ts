import type { RepoList, RepoSummary } from "../../lib/contracts";
import { MAX_PATH_LENGTH } from "./guards";

/**
 * Matching VS Code's paths to the index's (Review Focus 1, P15). VS Code gives native paths with its own drive-letter
 * spelling (`c:\Users\…\src\a.ts`), while the index stores each root absolute with forward slashes (`C:/Users/…`), and
 * the Map speaks repo-relative paths (`src/a.ts`). Paths compare a segment at a time, ignoring case on Windows (its file
 * system does) and only there, so `/home/a/Repo` and `/home/a/repo` stay two folders on Linux.
 */

/** A path's segments: backslashes read as slashes, trailing slashes dropped. `/a/b` gives `["", "a", "b"]`. */
function segmentsOf(p: string): string[] {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
}

function sameSegment(a: string, b: string, platform: NodeJS.Platform): boolean {
    return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The segments of `p` below `root`, or null when `p` isn't `root` or inside it. */
function below(root: string, p: string, platform: NodeJS.Platform): string[] | null {
    const rootSegments = segmentsOf(root);
    const pathSegments = segmentsOf(p);
    if (pathSegments.length < rootSegments.length) return null;
    for (let i = 0; i < rootSegments.length; i++){
        if (!sameSegment(rootSegments[i], pathSegments[i], platform)) return null;
    }
    return pathSegments.slice(rootSegments.length);
}

/** One path in two spellings: slashes either way, a trailing slash or not, and on Windows (only) any case. */
export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
    return segmentsOf(a).length === segmentsOf(b).length && below(a, b, platform) !== null;
}

/**
 * The indexed repo a workspace folder belongs to: the one whose root is the folder or holds it. Nested repos give the
 * longest root. Roots that are one path by samePath (on Windows, a drive-letter case apart) give the one equal to
 * `list.active`, else the first listed, so the extension never switches between two spellings of one repo. A folder
 * above every root matches none: it's offered "Index this repo (free)" for itself (P15).
 */
export function repoFor(list: RepoList, folderFsPath: string, platform: NodeJS.Platform): RepoSummary | null {
    let best: RepoSummary | null = null;
    let bestDepth = -1;
    for (const repo of list.repos){
        if (below(repo.root, folderFsPath, platform) === null) continue;
        const depth = segmentsOf(repo.root).length;
        // two roots that both hold the folder at one depth are one path, so `active` decides between them
        const better = depth > bestDepth || (depth === bestDepth && repo.root === list.active && best?.root !== list.active);
        if (better){
            best = repo;
            bestDepth = depth;
        }
    }
    return best;
}

/** The file's repo-relative path (forward slashes), or null outside the root. The root itself isn't a file: null. */
export function relativeIn(root: string, fileFsPath: string, platform: NodeJS.Platform): string | null {
    const rest = below(root, fileFsPath, platform);
    return rest === null || rest.length === 0 ? null : rest.join("/");
}

/** A stored root as a file URI's path: `C:/x` → `/C:/x`, and `/home/x` stays. */
export function uriPathOf(root: string): string {
    const slashed = root.replace(/\\/g, "/");
    return slashed.startsWith("/") ? slashed : `/${slashed}`;
}

/**
 * On Windows, a leading drive letter upper-cased: git's spelling (`git rev-parse --show-toplevel`), which the index
 * stores. So "Index this repo" for VS Code's `c:\…` never adds a second `c:/…` root beside `C:/…` (P15). Elsewhere
 * the path is unchanged.
 */
export function upperCaseDrive(fsPath: string, platform: NodeJS.Platform): string {
    if (platform !== "win32" || !/^[a-z]:/.test(fsPath)) return fsPath;
    return fsPath[0].toUpperCase() + fsPath.slice(1);
}

/**
 * A path the Map asked the editor to open (P17), checked by the rule the server's parseRepoPath (lib/index/paths.ts)
 * uses, written again here because the extension imports no code from lib/ (P3). Backslashes become "/", the spaces
 * around it and empty or "." segments go. Null for more than 1,024 characters, a NUL, a leading "/", a drive letter, a
 * ".." segment, or nothing left (the repo root isn't a file to open).
 */
export function checkRepoPath(raw: string): string | null {
    if (raw.length > MAX_PATH_LENGTH) return null;
    const slashed = raw.trim().replace(/\\/g, "/");
    if (slashed.includes("\0") || slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) return null;
    const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.includes("..") || segments.length === 0) return null;
    return segments.join("/");
}
