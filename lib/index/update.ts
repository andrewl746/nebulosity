import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
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
import { DEFAULT_MAX_FILE_BYTES, gitIgnored, isExcludedPath, readGitHead } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { normalizeSlashes, repoKey } from "./paths";
import { toFileRecord } from "./pipeline";
import { createResolver, edgesFrom } from "./resolve";

export type FileChangeResult = {
    repoId: number;
    /** Files whose new bytes are now indexed: edited or created. */
    changed: string[];
    /** Files that left the index: deleted, renamed away, now ignored, or grown past the size cap. */
    deleted: string[];
    /** Paths that needed nothing: the same bytes, or never a source file. */
    unchanged: number;
    errors: FileError[];
    /** Every file's imports were re-resolved: the file set changed, or a tsconfig did (ADR-037). */
    resolvedAll: boolean;
    edgesAdded: number;
    edgesRemoved: number;
    totalMs: number;
    /** The repo's index version afterwards: it moves only when something changed. */
    indexVersion: number;
};

/** A tsconfig decides what bare specifiers resolve to everywhere below it, so changing one re-resolves every file. */
const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/;

/**
 * The incremental structure update (PIVOT_SPEC.md §5.6, ADR-037): what the background worker runs for the paths a
 * watcher reported, as repo-relative paths. Each path is looked at as it is now.
 * - An edited file is re-parsed and its own imports re-resolved.
 * - A created or deleted file, or a changed tsconfig, re-resolves every file's imports in memory: a new file can be what
 *   "../core" now means.
 * Either way only the differences are written (import rows, level-edge counts, folder counts), so the result is what a
 * full run would store, without rewriting VS Code's 139,580 unchanged imports.
 */
export function applyFileChanges(repoRoot: string, changedPaths: readonly string[], options: { maxFileBytes?: number } = {}): FileChangeResult {
    const started = performance.now();
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
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
            if (size === null || size > maxBytes || excluded(rel) || ignored.has(rel)){
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
                records.push(toFileRecord(rel, text, contentHash, size));
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
        const resolvedAll = fileSetChanged || paths.some((p) => TSCONFIG.test(p));
        const current = loadStoredFiles(db, repoId);
        const resolve = createResolver(root, new Set(current.keys()));

        // the imports as they are now against as they were: every file's when the file set or a tsconfig changed,
        // else only the changed files' own (a file that failed keeps its old row and old edges, ADR-022)
        const sources = resolvedAll ? [...current.keys()] : changed;
        const before = resolvedAll ? loadImportEdges(db, repoId) : loadImportEdgesFrom(db, repoId, changed);
        const after = sources.flatMap((source) => edgesFrom(resolve, source, current.get(source)!.importSpecifiers));
        const { removed, added } = diffEdges(before, after);

        applyEdgeChanges(db, repoId, removed, added, levelEdgeDeltas([...removed, ...cascaded], added));
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
