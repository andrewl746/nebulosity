import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
import { replaceEntryPoints } from "../db/store/entries";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import { fillCodeSearch, isCodeSearchDeferred } from "../db/store/search";
import { writeStage } from "../db/store/stages";
import {
    applyEdgeChanges, deleteFiles, loadImportEdges, loadImportEdgesFrom, loadImportEdgesTouching, loadStoredFiles,
    markIndexed, requireRepository, syncFolders, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { pruneSummaries } from "../db/store/summaries";
import { bumpIndexVersion, readIndexVersion } from "../db/store/version";
import { buildFolders, levelEdgeDeltas } from "./aggregate";
import { DEFAULT_HARD_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, gitIgnored, isExcludedPath, listManifests, readGitHead } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { normalizeSlashes, repoKey } from "./paths";
import { toFileRecord } from "./pipeline";
import { createResolver, createSourceFinder, edgesFrom } from "./resolve";
import { declaredEntries, readWorkspace } from "./workspace";

export type FileChangeResult = {
    repoId: number;
    /** Files whose new bytes are now indexed: edited or created. */
    changed: string[];
    /** Files that left the index: deleted, renamed away, now ignored, or grown past the hard bound (a file over the size cap stays, imports only). */
    deleted: string[];
    /** Paths that needed nothing: the same bytes, or never a source file. */
    unchanged: number;
    errors: FileError[];
    /** Every file's imports were re-resolved: the file set changed, or a tsconfig, a package.json or a workspace declaration did (ADR-037, ADR-053). */
    resolvedAll: boolean;
    edgesAdded: number;
    edgesRemoved: number;
    totalMs: number;
    /** The repo's index version afterwards: it moves only when something changed. */
    indexVersion: number;
};

/**
 * A tsconfig or a package.json decides what bare specifiers resolve to everywhere below it, and the root's
 * pnpm-workspace.yaml or lerna.json which packages may be named (ADR-053).
 */
const RESOLUTION_INPUT = /(^|\/)(tsconfig[^/]*|package)\.json$|^(pnpm-workspace\.yaml|lerna\.json)$/;

/** Whether a changed path re-resolves every file's imports: a tsconfig, a package.json or a workspace declaration changed. */
export function resolvesEverything(changedPath: string): boolean {
    return RESOLUTION_INPUT.test(changedPath);
}

/**
 * The incremental structure update (PIVOT_SPEC.md §5.6, ADR-037): what the background worker runs for the paths a
 * watcher reported, as repo-relative paths. Each path is looked at as it is now.
 * - An edited file is re-parsed and its own imports re-resolved.
 * - A created or deleted file, or a changed tsconfig, package.json or workspace declaration, re-resolves every file's
 *   imports in memory: a new file can be what "../core" now means. The declared entry points are re-read then too.
 * Either way only the differences are written (import rows, level-edge counts, folder counts), so the result is what a
 * full run would store, without rewriting VS Code's 139,580 unchanged imports.
 * A file over the size cap is read for its imports only, and one past the hard bound leaves the index, as in a full run.
 */
export function applyFileChanges(
    repoRoot: string, changedPaths: readonly string[], options: { maxFileBytes?: number; hardMaxFileBytes?: number } = {}
): FileChangeResult {
    const started = performance.now();
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const hardMaxBytes = options.hardMaxFileBytes ?? DEFAULT_HARD_MAX_FILE_BYTES;
    const usedGit = fs.existsSync(path.join(root, ".git"));
    const excluded = (rel: string): boolean => isExcludedPath(rel, { extensions: TYPESCRIPT_EXTENSIONS, usedGit });

    acquireIndexLock(db);
    try{
        // a bulk run that died before filling code search left it deferred: repair that before anything else
        if (isCodeSearchDeferred(db)) fillCodeSearch(db);

        const stored = loadStoredFiles(db, repoId);
        const paths = expandFolders(changedPaths, stored);
        // a new path .gitignore excludes never entered the index; one git call answers for all of them
        const ignored = usedGit ? gitIgnored(root, paths.filter((p) => !stored.has(p) && !excluded(p))) : new Set<string>();

        const records: FileRecord[] = [];
        const gone: string[] = [];
        const errors: FileError[] = [];
        let unchanged = 0;

        for (const rel of paths){
            const size = fileSize(path.join(root, rel));
            if (size === null || size > hardMaxBytes || excluded(rel) || ignored.has(rel)){
                // not a source file now: if the index has it, it goes
                if (stored.has(rel)) gone.push(rel);
                else unchanged++;
                continue;
            }

            let text: string;
            try{
                text = fs.readFileSync(path.join(root, rel), "utf8");
            } catch (err){
                errors.push({ path: rel, error: messageOf(err) });
                continue;
            }

            const contentHash = createHash("sha256").update(text).digest("hex");
            // ADR-022: the hash means "the indexer last processed exactly these bytes"
            if (stored.get(rel)?.contentHash === contentHash){
                unchanged++;
                continue;
            }

            try{
                records.push(toFileRecord(rel, text, contentHash, size, { importsOnly: size > maxBytes }));
            } catch (err){
                errors.push({ path: rel, error: messageOf(err) });
            }
        }

        const writeErrors = writeFileRecords(db, repoId, records);
        errors.push(...writeErrors);
        const failed = new Set(writeErrors.map((e) => e.path));
        const changed = records.map((r) => r.path).filter((p) => !failed.has(p));

        // deleting a file cascades its imports away: capture them first, for the level-edge counts
        const cascaded = loadImportEdgesTouching(db, repoId, gone);
        const deleted = deleteFiles(db, repoId, gone);

        const fileSetChanged = changed.some((p) => !stored.has(p)) || deleted.length > 0;
        const resolvedAll = fileSetChanged || paths.some(resolvesEverything);
        const current = loadStoredFiles(db, repoId);
        const fileSet = new Set(current.keys());
        // read on every update, not only when everything re-resolves: an edited file's workspace, module-id and
        // computed edges need it as much as a full run's do (one git ls-files, about 0.1 s on VS Code)
        const workspace = readWorkspace(root, listManifests(root));
        const resolve = createResolver(root, fileSet, { workspace });

        // the imports as they are now against as they were: every file's when the file set or a resolution input changed,
        // else only the changed files' own (a file that failed keeps its old row and old edges, ADR-022)
        const sources = resolvedAll ? [...current.keys()] : changed;
        const before = resolvedAll ? loadImportEdges(db, repoId) : loadImportEdgesFrom(db, repoId, changed);
        const after = sources.flatMap((source) => edgesFrom(resolve, source, current.get(source)!.importSpecifiers));
        const { removed, added } = diffEdges(before, after);

        applyEdgeChanges(db, repoId, removed, added, levelEdgeDeltas([...removed, ...cascaded], added));
        if (resolvedAll) replaceEntryPoints(db, repoId, declaredEntries(workspace, createSourceFinder(fileSet, workspace)));
        if (fileSetChanged){
            syncFolders(db, repoId, buildFolders([...current.keys()], path.basename(root)));
            pruneSummaries(db, repoId);   // a deleted file, or a folder left empty, takes its summary with it
        }

        const anything = changed.length > 0 || deleted.length > 0 || removed.length > 0 || added.length > 0;
        if (anything){
            markIndexed(db, repoId, readGitHead(root));
            writeStage(db, repoId, "structure", {
                state: "ready",
                done: current.size,
                total: current.size,
                ...(errors.length > 0 ? { note: `${errors.length} files failed to index` } : {}),
            });
        }

        return {
            repoId,
            changed,
            deleted,
            unchanged,
            errors,
            resolvedAll,
            edgesAdded: added.length,
            edgesRemoved: removed.length + cascaded.length,
            totalMs: performance.now() - started,
            indexVersion: anything ? bumpIndexVersion(db, repoId) : readIndexVersion(db, repoId),
        };
    } finally{
        releaseIndexLock(db);
    }
}

/**
 * The paths to look at. A path the index doesn't hold may be a whole folder that was deleted or renamed (a watcher's
 * unlinkDir), so every indexed file under it is looked at too.
 */
function expandFolders(changedPaths: readonly string[], stored: ReadonlyMap<string, unknown>): string[] {
    const paths = new Set(changedPaths.map(normalizeSlashes));
    for (const rel of [...paths]){
        if (stored.has(rel)) continue;
        const prefix = `${rel}/`;
        for (const filePath of stored.keys()) if (filePath.startsWith(prefix)) paths.add(filePath);
    }
    return [...paths].sort();
}

/** The size of a regular file, or null when there's no file there (deleted, or a folder). */
function fileSize(absolute: string): number | null {
    try{
        const stat = fs.statSync(absolute);
        return stat.isFile() ? stat.size : null;
    } catch{
        return null;
    }
}

/** Import rows to delete and to insert. The specifier is part of the key, so a rewritten specifier replaces its row. */
function diffEdges(before: readonly ImportEdge[], after: readonly ImportEdge[]): { removed: ImportEdge[]; added: ImportEdge[] } {
    const key = (e: ImportEdge): string => `${e.source}\0${e.target}\0${e.specifier}`;
    const beforeKeys = new Set(before.map(key));
    const afterKeys = new Set(after.map(key));
    return {
        removed: before.filter((e) => !afterKeys.has(key(e))),
        added: after.filter((e) => !beforeKeys.has(key(e))),
    };
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
