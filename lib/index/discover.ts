import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { normalizeSlashes } from "./paths";

export type DiscoveredFile = {
    path: string;
    sizeBytes: number;
    /**
     * A code file over the size cap: indexed for its imports only, with no declarations, chunks or summary (ADR-053).
     * "parse" up to the parse bound (the full adapter), "scan" past it (the token scan).
     */
    importsOnly?: "parse" | "scan";
};
export type SkippedFile = { path: string; reason: string };
export type DiscoveryResult = {
    files: DiscoveredFile[];
    skipped: SkippedFile[];
    usedGit: boolean;
    /** package.json and tsconfig*.json files: what resolving bare specifiers reads (ADR-053). Sorted. */
    manifests: string[];
    /** Markdown docs under the size cap: what the docs pointers read (ADR-054). Sorted. */
    docs: DiscoveredFile[];
};

/** A package.json or a tsconfig*.json (tsconfig.json, tsconfig.base.json, …). */
export const MANIFEST = /(^|\/)(package\.json|tsconfig[^/]*\.json)$/;

/** The docs' extensions: Markdown, MDX, and Cursor's rule files. */
export const DOC_EXTENSIONS: readonly string[] = [".md", ".mdx", ".mdc"];

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Bigger than this is almost always generated or minified code, not something to read: a code file over it is indexed
 * for its imports only (ADR-053, amended), and a doc over it is skipped. VS Code's three agent-host tests of 1.0–1.6 MB
 * import real files, which is why the cap no longer drops a file outright.
 */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/**
 * Up to this, a code file over the cap is still parsed in full for its imports, so they follow the adapter's own rule:
 * about 90–150 ms for VS Code's 1.0–1.6 MB tests, 830 ms and 180 MB of heap for AFFiNE's 3.8 MB minified yarn release.
 * Past it the token scan reads them, which costs a tenth of that but misreads some code (scanTypeScriptImports).
 */
export const DEFAULT_PARSE_MAX_FILE_BYTES = 5_000_000;

/**
 * Past this a code file isn't read at all, so a giant generated blob can't stall a run or run the process out of
 * memory: the token scan costs about 15 ms a megabyte (about 0.3 s at the bound). VS Code's largest code file is an
 * 8.5 MB colorizer fixture, AFFiNE's a 3.8 MB yarn release.
 */
export const DEFAULT_HARD_MAX_FILE_BYTES = 20_000_000;

/** How a code file is read: in full, parsed for its imports only, scanned for its imports only, or not at all. */
export type FileReading = "full" | "parse" | "scan" | "skip";

/**
 * The reading for a code file of `size` bytes (ADR-053, amended): in full up to `maxBytes` (1 MB), parsed for its
 * imports up to `parseMaxBytes` (5 MB), token-scanned for them up to `hardMaxBytes` (20 MB), skipped past that.
 * A full run and the incremental update both ask this, so a file is read the same way by either.
 */
export function readingFor(size: number, caps: { maxBytes?: number; parseMaxBytes?: number; hardMaxBytes?: number } = {}): FileReading {
    if (size > (caps.hardMaxBytes ?? DEFAULT_HARD_MAX_FILE_BYTES)) return "skip";
    if (size <= (caps.maxBytes ?? DEFAULT_MAX_FILE_BYTES)) return "full";
    return size <= (caps.parseMaxBytes ?? DEFAULT_PARSE_MAX_FILE_BYTES) ? "parse" : "scan";
}

/**
 * Folders never indexed, in either mode: dependency trees and tool output. Git mode
 * needs this too, because a repo whose .gitignore doesn't list node_modules would
 * otherwise hand over its whole dependency tree as untracked files.
 */
export const IGNORED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", ".next", ".nebulosity"]);

/**
 * Build output and coverage reports, skipped only when walking. In a git repo .gitignore
 * already decides, and a tracked folder with one of these names can be real source:
 * VS Code keeps its build scripts in build/.
 */
export const WALK_ONLY_IGNORED_DIRS: ReadonlySet<string> = new Set(["dist", "out", "build", "coverage"]);

/**
 * Lists a repository's source files as sorted, repo-relative, forward-slash paths.
 *
 * In a git repo this asks git (`ls-files`), which honours .gitignore for free. That's
 * what keeps build output and vendored code out of a big repo's index. Without git,
 * it walks the tree and skips the usual heavy folders and build output.
 *
 * A code file over `maxBytes` is listed with `importsOnly` set to how its imports are read, and one over `hardMaxBytes`
 * is skipped (readingFor, ADR-053).
 */
export function discoverFiles(
    repoRoot: string,
    opts: { extensions: readonly string[]; maxBytes?: number; parseMaxBytes?: number; hardMaxBytes?: number }
): DiscoveryResult {
    const usedGit = fs.existsSync(path.join(repoRoot, ".git"));
    const skipped: SkippedFile[] = [];
    const candidates = usedGit ? listWithGit(repoRoot) : listByWalking(repoRoot, skipped);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    const files: DiscoveredFile[] = [];
    const manifests: string[] = [];
    const docs: DiscoveredFile[] = [];

    for (const rel of candidates){
        const base = rel.slice(rel.lastIndexOf("/") + 1);

        if (base.startsWith(".env")) continue; // never index secrets, whatever the extension
        if (MANIFEST.test(rel)){
            manifests.push(rel);
            continue;
        }
        if (DOC_EXTENSIONS.some((ext) => rel.toLowerCase().endsWith(ext))){
            const docSize = sizeOf(path.join(repoRoot, rel));
            if (docSize === null) skipped.push({ path: rel, reason: "unreadable: no size" });
            else if (docSize > maxBytes) skipped.push({ path: rel, reason: `too large (${docSize} bytes)` });
            else docs.push({ path: rel, sizeBytes: docSize });
            continue;
        }
        if (!opts.extensions.some((ext) => rel.endsWith(ext))) continue;

        let size: number;
        try{
            size = fs.statSync(path.join(repoRoot, rel)).size;
        } catch (err){
            // e.g. deleted from the working tree but still tracked by git
            skipped.push({ path: rel, reason: `unreadable: ${err instanceof Error ? err.message : String(err)}` });
            continue;
        }

        const reading = readingFor(size, opts);
        if (reading === "skip"){
            skipped.push({ path: rel, reason: `too large (${size} bytes)` });
            continue;
        }

        files.push(reading === "full" ? { path: rel, sizeBytes: size } : { path: rel, sizeBytes: size, importsOnly: reading });
    }

    // plain code-unit order: deterministic on every OS and locale
    files.sort(byPath);
    return { files, skipped, usedGit, manifests: manifests.sort(), docs: docs.sort(byPath) };
}

/** The repo's package.json and tsconfig*.json files now, as discoverFiles lists them (one git call or one walk). */
export function listManifests(repoRoot: string): string[] {
    const usedGit = fs.existsSync(path.join(repoRoot, ".git"));
    const candidates = usedGit ? listWithGit(repoRoot) : listByWalking(repoRoot, []);
    return candidates.filter((rel) => MANIFEST.test(rel)).sort();
}

function sizeOf(absolute: string): number | null {
    try{
        return fs.statSync(absolute).size;
    } catch{
        return null;
    }
}

function listWithGit(repoRoot: string): string[] {
    // --cached: tracked files. --others --exclude-standard: new files .gitignore doesn't exclude.
    // -z: NUL-separated, so names with spaces or non-ASCII characters arrive unquoted.
    const out = execFileSync(
        "git",
        ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { maxBuffer: 512 * 1024 * 1024 }
    );

    return out.toString("utf8").split("\0").filter(Boolean).map(normalizeSlashes).filter((rel) => !inIgnoredDir(rel));
}

/** True when any folder on the path (not the file name itself) is in IGNORED_DIRS. */
function inIgnoredDir(rel: string): boolean {
    return rel.split("/").slice(0, -1).some((part) => IGNORED_DIRS.has(part));
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
            if (IGNORED_DIRS.has(entry.name)) continue;
            if (entry.isDirectory() && WALK_ONLY_IGNORED_DIRS.has(entry.name)) continue;

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

/**
 * Whether discoverFiles would leave this path out whatever its contents: a .env file, an extension no adapter claims,
 * or a folder it never enters (plus build output when walking). The incremental update (update.ts) asks this of every
 * path a watcher reports, so a file is in the index exactly when a full run would put it there.
 */
export function isExcludedPath(rel: string, opts: { extensions: readonly string[]; usedGit: boolean }): boolean {
    const segments = rel.split("/");
    const base = segments[segments.length - 1];
    if (base.startsWith(".env") || !opts.extensions.some((ext) => rel.endsWith(ext))) return true;

    const parents = segments.slice(0, -1);
    if (parents.some((segment) => IGNORED_DIRS.has(segment))) return true;
    return !opts.usedGit && parents.some((segment) => WALK_ONLY_IGNORED_DIRS.has(segment));
}

/**
 * Which of these paths .gitignore excludes, asked of git once for all of them. Tracked files are never reported, by
 * git's own rule, which matches ls-files. Exit status 1 means none is ignored; a git that can't answer ignores nothing.
 */
export function gitIgnored(repoRoot: string, rels: readonly string[]): Set<string> {
    if (rels.length === 0) return new Set();

    try{
        const out = execFileSync("git", ["-C", repoRoot, "check-ignore", "-z", "--stdin"], {
            input: rels.join("\0"),
            stdio: ["pipe", "pipe", "ignore"],
            maxBuffer: 64 * 1024 * 1024,
        });
        return new Set(out.toString("utf8").split("\0").filter(Boolean).map(normalizeSlashes));
    } catch{
        return new Set();
    }
}
