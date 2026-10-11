import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { normalizeSlashes } from "./paths";

export type DiscoveredFile = { path: string; sizeBytes: number };
export type SkippedFile = { path: string; reason: string };
export type DiscoveryResult = { files: DiscoveredFile[]; skipped: SkippedFile[]; usedGit: boolean };

/** Bigger than this is almost always generated or minified code, not something to read. */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/** Folders never worth walking when there is no .gitignore to consult. */
const WALK_IGNORE = new Set(["node_modules", ".git", ".next", ".nebulosity"]);

/**
 * Lists a repository's source files as sorted, repo-relative, forward-slash paths.
 *
 * In a git repo this asks git (`ls-files`), which honours .gitignore for free. That's
 * what keeps build output and vendored code out of a big repo's index. Without git,
 * it walks the tree and skips the usual heavy folders.
 */
export function discoverFiles(
    repoRoot: string,
    opts: { extensions: readonly string[]; maxBytes?: number }
): DiscoveryResult {
    const usedGit = fs.existsSync(path.join(repoRoot, ".git"));
    const skipped: SkippedFile[] = [];
    const candidates = usedGit ? listWithGit(repoRoot) : listByWalking(repoRoot, skipped);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    const files: DiscoveredFile[] = [];

    for (const rel of candidates){
        const base = rel.slice(rel.lastIndexOf("/") + 1);

        if (base.startsWith(".env")) continue; // never index secrets, whatever the extension
        if (!opts.extensions.some((ext) => rel.endsWith(ext))) continue;

        let size: number;
        try{
            size = fs.statSync(path.join(repoRoot, rel)).size;
        } catch (err){
            // e.g. deleted from the working tree but still tracked by git
            skipped.push({ path: rel, reason: `unreadable: ${err instanceof Error ? err.message : String(err)}` });
            continue;
        }

        if (size > maxBytes){
            skipped.push({ path: rel, reason: `too large (${size} bytes)` });
            continue;
        }

        files.push({ path: rel, sizeBytes: size });
    }

    // plain code-unit order: deterministic on every OS and locale
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, skipped, usedGit };
}

function listWithGit(repoRoot: string): string[] {
    // --cached: tracked files. --others --exclude-standard: new files .gitignore doesn't exclude.
    // -z: NUL-separated, so names with spaces or non-ASCII characters arrive unquoted.
    const out = execFileSync(
        "git",
        ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { maxBuffer: 512 * 1024 * 1024 }
    );

    return out.toString("utf8").split("\0").filter(Boolean).map(normalizeSlashes);
}

function listByWalking(repoRoot: string, skipped: SkippedFile[]): string[] {
    const out: string[] = [];

    const walk = (dirRel: string): void => {
        let entries: fs.Dirent[];

        try{
            entries = fs.readdirSync(path.join(repoRoot, dirRel), { withFileTypes: true });
        } catch (err){
            skipped.push({ path: dirRel || ".", reason: `unreadable directory: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }

        for (const entry of entries){
            if (WALK_IGNORE.has(entry.name)) continue;

            // built with "/" by hand: path.join would put backslashes in on Windows
            const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;

            // Dirent reports symlinks as neither file nor directory, so links are
            // skipped rather than followed (no symlink cycles)
            if (entry.isDirectory()) walk(rel);
            else if (entry.isFile()) out.push(rel);
        }
    };

    walk("");
    return out;
}

/** Test code is indexed, but later stages treat it differently (e.g. no LLM summary). */
export function isTestPath(relPath: string): boolean {
    return /(^|\/)(test|tests|__tests__)\//.test(relPath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
}

/** The commit the working tree is on, or null outside git or before the first commit. */
export function readGitHead(repoRoot: string): string | null {
    if (!fs.existsSync(path.join(repoRoot, ".git"))) return null;

    try{
        const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
        return head || null;
    } catch{
        return null;
    }
}
