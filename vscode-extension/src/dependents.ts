import type { ImportsResponse } from "../../lib/contracts";

/**
 * The "What depends on this file?" QuickPick (design §4.5), from one page of `GET /api/imports`' dependents
 * (API_CONTRACTS §19). Each file is a row: its name, with its folder beside it; a list its page cut short ends with a
 * note that says so.
 */

/** The part of a repo-relative path after its last "/": the whole path for a file at the root. */
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The part before its last "/": "" for a file at the root. */
const folderOf = (path: string): string => {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
};

/** A count as the pick writes it: "2,631". */
const countOf = (n: number): string => n.toLocaleString("en-US");

/**
 * "3 files import log.ts"; with indirect importers listed, "7 files import log.ts, 4 of them indirectly"; "1 file
 * imports index.ts"; "No file imports build.js". The count is `total`, every page's files, not this page's.
 */
export function pickTitle(r: ImportsResponse): string {
    const name = nameOf(r.path);
    if (r.total === 0) return `No file imports ${name}`;
    const count = r.total === 1 ? `1 file imports ${name}` : `${countOf(r.total)} files import ${name}`;
    // `direct` counts the distance-1 files whatever `transitive` is, so the rest of a transitive answer came indirectly
    const indirect = r.transitive ? r.total - r.direct : 0;
    return indirect > 0 ? `${count}, ${countOf(indirect)} of them indirectly` : count;
}

/**
 * The row under a list its page cut short, "Showing the first 500 of 2,631, nearest first", since the title counts them
 * all and typing filters only the ones listed. It has no path, so picking it does nothing, and `alwaysShow` keeps it in
 * view while typing. Null when the page holds every file.
 */
export function pickNote(r: ImportsResponse): { label: string; alwaysShow: true; path: null } | null {
    if (r.total <= r.files.length) return null;
    return { label: `Showing the first ${countOf(r.files.length)} of ${countOf(r.total)}, nearest first`, alwaysShow: true, path: null };
}

/** The page's files in the answer's order (nearest first), each as a QuickPick row that keeps its path. */
export function pickItems(r: ImportsResponse): { label: string; description: string; path: string }[] {
    return r.files.map((file) => ({ label: nameOf(file.path), description: folderOf(file.path), path: file.path }));
}
