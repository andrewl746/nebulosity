import { watch } from "chokidar";
import fs from "fs";
import path from "path";
import { gitIgnored, IGNORED_DIRS, WALK_ONLY_IGNORED_DIRS } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { normalizeSlashes } from "./paths";

export type Batcher = { add(item: string): void; flush(): void; cancel(): void };

/**
 * Collects items until `quietMs` pass with nothing new, then hands them all over at once, sorted. That's the 1 s
 * debounce structure updates get (PIVOT_SPEC.md §5.6). A steady trickle, like a formatter walking the tree, can't hold
 * a batch back forever: `maxWaitMs` after a batch's first item it goes anyway.
 */
export function createBatcher(onFlush: (items: string[]) => void, timing: { quietMs: number; maxWaitMs: number }): Batcher {
    let items = new Set<string>();
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
        if (quiet) clearTimeout(quiet);
        if (deadline) clearTimeout(deadline);
        quiet = null;
        deadline = null;
    };

    const flush = (): void => {
        clearTimers();
        if (items.size === 0) return;
        const batch = [...items].sort();
        items = new Set();
        onFlush(batch);
    };

    return {
        add(item){
            items.add(item);
            if (quiet) clearTimeout(quiet);
            quiet = setTimeout(flush, timing.quietMs);
            deadline ??= setTimeout(flush, timing.maxWaitMs);
        },
        flush,
        cancel(){
            clearTimers();
            items = new Set();
        },
    };
}

/** What a watcher reports: source files, plus the files that change which sources exist or what they resolve to. */
export function isWatchedFile(rel: string): boolean {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    return TYPESCRIPT_EXTENSIONS.some((ext) => rel.endsWith(ext)) || /^tsconfig[^/]*\.json$/.test(base) || base === ".gitignore";
}

/**
 * Which folders a watcher never enters. A compile rewrites thousands of files in build output, none of which the index
 * holds, and each would otherwise be an event (VS Code: out/, and every extension's dist/ or out/). A folder is skipped
 * when, or when a folder above it is:
 * - one discovery never enters (node_modules, .git…), anywhere;
 * - build output by name (dist, out, build, coverage), anywhere. In a git repo only when .gitignore leaves it out:
 *   VS Code tracks 469 files under build/, and discovery would index them;
 * - a top-level folder .gitignore leaves out (VS Code's .build, out-build…).
 * Each folder is decided once and remembered; git is asked one folder at a time, only about those two kinds.
 */
export function createFolderFilter(repoRoot: string, usedGit: boolean): (folder: string) => boolean {
    const decided = new Map<string, boolean>();
    // the trailing slash tells git it's a folder, so directory-only patterns like "out/" match
    const ignoredByGit = (folder: string): boolean => usedGit && gitIgnored(repoRoot, [`${folder}/`]).size > 0;

    const skipsItself = (folder: string): boolean => {
        let skip = decided.get(folder);
        if (skip === undefined){
            const name = folder.slice(folder.lastIndexOf("/") + 1);
            if (IGNORED_DIRS.has(name)) skip = true;
            else if (WALK_ONLY_IGNORED_DIRS.has(name)) skip = !usedGit || ignoredByGit(folder);
            else skip = !folder.includes("/") && ignoredByGit(folder);
            decided.set(folder, skip);
        }
        return skip;
    };

    return (folder) => {
        const segments = folder.split("/");
        for (let i = 1; i <= segments.length; i++){
            if (skipsItself(segments.slice(0, i).join("/"))) return true;
        }
        return false;
    };
}

export type RepoWatcher = { ready: Promise<void>; close(): Promise<void> };

/**
 * Watches a repo for changes the index cares about (PIVOT_SPEC.md §5.6) and reports them in batches, as repo-relative
 * paths. It only says "look at these": the incremental update (update.ts) decides what each path now means. A deleted
 * folder is reported as the folder's own path, and the update expands it. Folders createFolderFilter skips are never
 * watched: node_modules alone can hold more files than the repo, and build output churns on every compile.
 *
 * A watcher error (Linux's inotify limit, too many open files) goes to onError and watching goes on. Unreported, it
 * would throw out of chokidar's EventEmitter and kill the background worker, and every restart would meet it again.
 */
export function watchRepository(
    repoRoot: string,
    onChanges: (paths: string[]) => void,
    options: { quietMs?: number; maxWaitMs?: number; onError?: (err: Error) => void } = {}
): RepoWatcher {
    const root = path.resolve(repoRoot);
    const batcher = createBatcher(onChanges, { quietMs: options.quietMs ?? 1000, maxWaitMs: options.maxWaitMs ?? 5000 });
    const relative = (absolute: string): string => normalizeSlashes(path.relative(root, absolute));
    // git or not, decided the way discoverFiles decides it
    const skipsFolder = createFolderFilter(root, fs.existsSync(path.join(root, ".git")));

    const watcher = watch(root, {
        ignoreInitial: true,
        // a folder this user can't read (a root-owned Docker volume) is skipped quietly, as git and discovery skip it
        ignorePermissionErrors: true,
        ignored: (absolute, stats) => {
            const rel = relative(absolute);
            if (rel === "") return false;
            if (rel.split("/").some((segment) => IGNORED_DIRS.has(segment))) return true;
            // the folders above the path; the path itself once chokidar's stats say it's a folder
            const slash = rel.lastIndexOf("/");
            if (slash !== -1 && skipsFolder(rel.slice(0, slash))) return true;
            if (stats?.isDirectory() === true) return skipsFolder(rel);
            // chokidar asks again with stats once it has them; until then a dotted folder name can't be told from a file
            return stats?.isFile() === true && !isWatchedFile(rel);
        },
    });

    watcher.on("all", (event, absolute) => {
        if (event === "addDir") return;   // the files inside report themselves
        const rel = relative(absolute);
        if (event === "unlinkDir" || isWatchedFile(rel)) batcher.add(rel);
    });

    const onError = options.onError ?? ((err: Error) => console.error(`[watch] ${err.message}`));
    watcher.on("error", (err) => onError(err instanceof Error ? err : new Error(String(err))));

    const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    return {
        ready,
        async close(){
            batcher.cancel();
            await watcher.close();
        },
    };
}
