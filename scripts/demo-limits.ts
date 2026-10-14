/** What the static demo's host takes, and the reasons build-demo.ts refuses an out/ (ADR-049): Vercel's Hobby plan takes 15,000 files and 100 MB per CLI deployment. */
export const MAX_FILES = 14_000;
export const MAX_BYTES = 95_000_000;

/** One line per reason out/ must not be deployed; empty when it may be. Leaks come first. */
export function refusals(size: { files: number; bytes: number }, leakCount: number): string[] {
    const reasons: string[] = [];
    if (leakCount > 0) reasons.push(`${leakCount} ${leakCount === 1 ? "file holds" : "files hold"} a path of this machine or the git email (listed above)`);
    if (size.files > MAX_FILES) reasons.push(`${size.files.toLocaleString("en-US")} files > ${MAX_FILES.toLocaleString("en-US")}`);
    if (size.bytes > MAX_BYTES) reasons.push(`${(size.bytes / 1e6).toFixed(1)} MB > ${MAX_BYTES / 1e6} MB`);
    return reasons;
}
