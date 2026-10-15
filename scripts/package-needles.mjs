// The needles scripts/prepare-package.mjs scans a built Map for (ADR-058, ADR-051): every spelling of this machine's
// folders, by lib/demo/privacy.ts's rules. Plain JavaScript, with privacy.ts's leakNeedles passed in, so a test can call
// it without loading tsx.

/**
 * The needles for the folders deep enough to scan for. privacy.ts refuses a folder shallower than two segments (a home
 * of "/root" would match every path under /root), so such a one is left out and `note` says so. With none left (a
 * container that builds at /build with a home of /root), it throws, as privacy.ts's own scanForLeaks does: scanning for
 * nothing would call every file clean.
 * @param {readonly string[]} folders
 * @param {(input: { folders: readonly string[] }) => string[]} leakNeedles
 * @param {(note: string) => void} [note]
 * @returns {string[]}
 */
export function machineNeedles(folders, leakNeedles, note = console.log){
    const unique = [...new Set(folders)];
    const deep = unique.filter((folder) => folder.replace(/\\/g, "/").split("/").filter(Boolean).length >= 2);
    for (const folder of unique.filter((f) => !deep.includes(f))) note(`prepare-package: ${folder} is too shallow to scan for, so it isn't`);
    const needles = leakNeedles({ folders: deep });
    if (needles.length === 0){
        throw new Error(`prepare-package: nothing to scan for: every folder (${unique.join(", ")}) is too shallow, and scanning for nothing would call every file clean.`);
    }
    return needles;
}
