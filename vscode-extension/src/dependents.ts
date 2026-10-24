import type { ImportsResponse } from "../../lib/contracts";

/**
 * The "What depends on this file?" QuickPick (design §4.5), from one page of `GET /api/imports`' dependents
 * (API_CONTRACTS §19). Each file is a row: its name, with its folder beside it.
 */

/** The part of a repo-relative path after its last "/": the whole path for a file at the root. */
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The part before its last "/": "" for a file at the root. */
const folderOf = (path: string): string => {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
};

/**
 * "3 files import log.ts"; with indirect importers listed, "7 files import log.ts, 4 of them indirectly"; "1 file
 * imports index.ts"; "No file imports build.js". The count is `total`, every page's files, not this page's.
 */
export function pickTitle(r: ImportsResponse): string {
    const name = nameOf(r.path);
    if (r.total === 0) return `No file imports ${name}`;
    const count = r.total === 1 ? `1 file imports ${name}` : `${r.total} files import ${name}`;
    // `direct` counts the distance-1 files whatever `transitive` is, so the rest of a transitive answer came indirectly
    const indirect = r.transitive ? r.total - r.direct : 0;
    return indirect > 0 ? `${count}, ${indirect} of them indirectly` : count;
}

/** The page's files in the answer's order (nearest first), each as a QuickPick row that keeps its path. */
export function pickItems(r: ImportsResponse): { label: string; description: string; path: string }[] {
    return r.files.map((file) => ({ label: nameOf(file.path), description: folderOf(file.path), path: file.path }));
}
