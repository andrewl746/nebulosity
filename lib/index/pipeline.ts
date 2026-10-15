import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { IndexStage } from "../contracts";
import { getDb, type Db } from "../db/client";
import { replaceEntryPoints } from "../db/store/entries";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import { deferCodeSearch, fillCodeSearch, isCodeSearchDeferred } from "../db/store/search";
import { writeStage } from "../db/store/stages";
import {
    deleteFilesNotIn, loadStoredFiles, markIndexed, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { replaceDocs } from "../db/store/docs";
import { pruneSummaries } from "../db/store/summaries";
import { bumpIndexVersion, readAdapterVersion, writeAdapterVersion } from "../db/store/version";
import { buildFolders, buildLevelEdges } from "./aggregate";
import { docLinks, folderSuffixes, type KnownPaths } from "./docs";
import { discoverFiles, isTestPath, readGitHead, type DiscoveredFile, type SkippedFile } from "./discover";
import { splitIdentifier } from "./identifiers";
import { ADAPTER_VERSION, languageOf, TYPESCRIPT_EXTENSIONS, parseTypeScriptFile, parseTypeScriptImportsOnly } from "./languages/typescript";
import { repoKey } from "./paths";
import { createResolver, createSourceFinder, edgesFrom } from "./resolve";
import { declaredEntries, readWorkspace } from "./workspace";

export type { IndexStage };

export type IndexOptions = {
    /** Called at least once per stage, in order. done/total count files (folders for "aggregate"). */
    onProgress?: (stage: IndexStage, done: number, total: number) => void;
    /** Files parsed and committed per transaction. */
    batchSize?: number;
    /** A code file over this is indexed for its imports only (ADR-053). Default DEFAULT_MAX_FILE_BYTES (1 MB). */
    maxFileBytes?: number;
    /** A code file over this is skipped. Default DEFAULT_HARD_MAX_FILE_BYTES (20 MB). */
    hardMaxFileBytes?: number;
    /**
     * At least this many files to parse (new, or with no stored hash) and code search is filled in one go after the
     * structure stage instead of by a trigger per chunk (ADR-031, amended). Default 2,000.
     */
    bulkSearchThreshold?: number;
};

export type IndexResult = {
    repoId: number;
    /** Files in the index after this run. */
    files: number;
    changed: number;
    unchanged: number;
    deleted: string[];
    edges: number;
    folders: number;
    levelEdges: number;
    errors: FileError[];
    /** Files left out: over the hard bound, unreadable, or a doc over the cap. */
    skipped: SkippedFile[];
    /** Code files over the size cap, in the index for their imports only: no declarations, code search or summary (ADR-053). */
    importsOnly: DiscoveredFile[];
    timingsMs: Record<IndexStage, number>;
    totalMs: number;
    /** Filling code search after a bulk run (0 when it wasn't deferred); not part of totalMs (S1). */
    searchIndexMs: number;
    usedGit: boolean;
    indexedHead: string | null;
};

/** Thrown when the path to index isn't an existing directory (a typo, or a file). */
export class RepoNotFoundError extends Error {
    constructor(root: string){
        super(`No directory at ${root}`);
        this.name = "RepoNotFoundError";
    }
}

/**
 * The structure stage (PIVOT_SPEC.md §5.2): discover → parse changed files → write →
 * resolve every import → aggregate. When it returns, the Map has everything it needs.
 * Synchronous on purpose: better-sqlite3 and the TS parser are both synchronous, and
 * the Next server will run this on a worker thread (V1.3).
 */
export function indexRepository(repoRoot: string, options: IndexOptions = {}): IndexResult {
    const root = path.resolve(repoRoot);

    // Checked before anything touches the database: a mistyped path must fail loudly,
    // not "index" zero files, leave a repositories row for a path that never existed,
    // and become the active repo. An existing but empty folder is still fine.
    if (!isDirectory(root)){
        throw new RepoNotFoundError(root);
    }

    const db = getDb();
    const started = performance.now();
    const timingsMs: Record<IndexStage, number> = { discover: 0, parse: 0, write: 0, resolve: 0, aggregate: 0 };
    const batchSize = options.batchSize ?? 500;

    acquireIndexLock(db);
    let stageRepoId: number | null = null;   // set once the repo row exists, so a failure can be reported on it

    try{
        // a bulk run that died before filling code search left it deferred: repair that before anything else
        if (isCodeSearchDeferred(db)) fillCodeSearch(db);

        const repoId = upsertRepository(db, repoKey(root));
        stageRepoId = repoId;
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: 0, note: "discovering files" });

        // ---- discover ---------------------------------------------------------
        let t = performance.now();
        const discovered = discoverFiles(root, {
            extensions: TYPESCRIPT_EXTENSIONS, maxBytes: options.maxFileBytes, hardMaxBytes: options.hardMaxFileBytes,
        });
        const stored = loadStoredFiles(db, repoId);
        timingsMs.discover = performance.now() - t;
        options.onProgress?.("discover", discovered.files.length, discovered.files.length);
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: discovered.files.length });

        // files an older adapter parsed are parsed again whatever their hash: what it stored may lack what this one reads
        const reparseAll = readAdapterVersion(db, repoId) !== ADAPTER_VERSION;
        const toParse = reparseAll ? discovered.files.length : discovered.files.filter((f) => (stored.get(f.path)?.contentHash ?? "") === "").length;
        const deferred = toParse >= (options.bulkSearchThreshold ?? 2_000);
        if (deferred) deferCodeSearch(db);

        // ---- parse + write, one batch of files at a time (bounded memory) ------
        const errors: FileError[] = [];
        const skipped: SkippedFile[] = [...discovered.skipped];   // the docs read below add theirs
        let changed = 0;
        let unchanged = 0;

        for (let i = 0; i < discovered.files.length; i += batchSize){
            const processed = Math.min(i + batchSize, discovered.files.length);
            const slice = discovered.files.slice(i, i + batchSize);
            const records: FileRecord[] = [];

            t = performance.now();
            for (const file of slice){
                let text: string;
                try{
                    text = fs.readFileSync(path.join(root, file.path), "utf8");
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                    continue;
                }

                const contentHash = createHash("sha256").update(text).digest("hex");

                // ADR-022: the hash means "the indexer last processed exactly these bytes" (with this adapter, ADR-053)
                if (!reparseAll && stored.get(file.path)?.contentHash === contentHash){
                    unchanged++;
                    continue;
                }

                try{
                    records.push(toFileRecord(file.path, text, contentHash, file.sizeBytes, { importsOnly: file.importsOnly === true }));
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                }
            }
            timingsMs.parse += performance.now() - t;
            options.onProgress?.("parse", processed, discovered.files.length);

            t = performance.now();
            const writeErrors = writeFileRecords(db, repoId, records);
            errors.push(...writeErrors);
            changed += records.length - writeErrors.length;
            timingsMs.write += performance.now() - t;
            options.onProgress?.("write", processed, discovered.files.length);
            writeStage(db, repoId, "structure", { state: "running", done: processed, total: discovered.files.length });
        }

        // ---- resolve: the database is the source of truth from here on ---------
        // (a file that failed this run keeps its previous row and specifiers)
        t = performance.now();
        const deleted = deleteFilesNotIn(db, repoId, new Set(discovered.files.map((f) => f.path)));
        const current = loadStoredFiles(db, repoId);
        const fileSet = new Set(current.keys());
        const workspace = readWorkspace(root, discovered.manifests);
        const resolve = createResolver(root, fileSet, { workspace });
        const edges: ImportEdge[] = [];

        for (const [source, file] of current) edges.push(...edgesFrom(resolve, source, file.importSpecifiers));

        const edgeCount = replaceImports(db, repoId, edges);
        replaceEntryPoints(db, repoId, declaredEntries(workspace, createSourceFinder(fileSet, workspace)));
        timingsMs.resolve = performance.now() - t;
        options.onProgress?.("resolve", fileSet.size, fileSet.size);

        // ---- aggregate ------------------------------------------------------------
        t = performance.now();
        const folderRows = buildFolders([...fileSet], path.basename(root));
        const levelRows = buildLevelEdges(edges);
        replaceAggregates(db, repoId, folderRows, levelRows);
        pruneSummaries(db, repoId);   // a deleted file or folder takes its summary with it

        // which docs talk about which folders (ADR-054): read with the folders just built, so a mention can name any of them
        const folderPaths = folderRows.map((f) => f.path);
        const known: KnownPaths = { folders: new Set(folderPaths), files: fileSet, suffixes: folderSuffixes(folderPaths) };
        const readDocs = discovered.docs.flatMap((doc) => {
            try{
                return [docLinks(doc.path, fs.readFileSync(path.join(root, doc.path), "utf8"), known)];
            } catch (err){
                skipped.push({ path: doc.path, reason: `unreadable: ${message(err)}` });   // reported, as an unreadable source file is
                return [];
            }
        });
        replaceDocs(db, repoId, readDocs.map((d) => d.facts), readDocs.flatMap((d) => d.links));
        timingsMs.aggregate = performance.now() - t;
        options.onProgress?.("aggregate", folderRows.length, folderRows.length);

        const indexedHead = readGitHead(root);
        markIndexed(db, repoId, indexedHead);
        writeAdapterVersion(db, repoId, ADAPTER_VERSION);
        writeStage(db, repoId, "structure", {
            state: "ready",
            done: fileSet.size,
            total: fileSet.size,
            ...(errors.length > 0 ? { note: `${errors.length} files failed to index` } : {}),
        });
        bumpIndexVersion(db, repoId);   // the Map refetches what it shows (ADR-036)

        const totalMs = performance.now() - started;   // S1 is the structure stage: everything above
        const searchStarted = performance.now();
        if (deferred) fillCodeSearch(db);
        const searchIndexMs = deferred ? performance.now() - searchStarted : 0;

        return {
            repoId,
            files: fileSet.size,
            changed,
            unchanged,
            deleted,
            edges: edgeCount,
            folders: folderRows.length,
            levelEdges: levelRows.length,
            errors,
            skipped,
            importsOnly: discovered.files.filter((f) => f.importsOnly),
            timingsMs,
            totalMs,
            searchIndexMs,
            usedGit: discovered.usedGit,
            indexedHead,
        };
    } catch (err){
        if (stageRepoId !== null) reportStructureFailure(db, stageRepoId, err);
        throw err;
    } finally{
        releaseIndexLock(db);
    }
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function reportStructureFailure(db: Db, repoId: number, err: unknown): void {
    try{
        writeStage(db, repoId, "structure", { state: "failed", done: 0, total: 0, note: message(err) });
    } catch{
        // the database itself may be what failed; the original error matters more
    }
}

function isDirectory(p: string): boolean {
    try{
        return fs.statSync(p).isDirectory();
    } catch{
        return false;   // missing, or unreachable through a file (ENOTDIR)
    }
}

/**
 * One file's row as the structure store writes it, from its bytes (PIVOT_SPEC.md §5.2). Throws if the file can't be parsed.
 * A file over the size cap is read for its imports only: no declarations and no chunks, so no code search (ADR-053).
 */
export function toFileRecord(
    filePath: string, text: string, contentHash: string, sizeBytes: number, opts: { importsOnly?: boolean } = {}
): FileRecord {
    const parsed = opts.importsOnly ? parseTypeScriptImportsOnly(filePath, text) : parseTypeScriptFile(filePath, text);
    return {
        path: filePath,
        kind: /\.(tsx|jsx)$/.test(filePath) ? "component" : "module",
        contentHash,
        language: languageOf(filePath),
        sizeBytes,
        lineCount: parsed.lineCount,
        isTest: isTestPath(filePath),
        importSpecifiers: parsed.imports,
        chunks: parsed.chunks.map((c) => ({ ...c, nameSplit: splitIdentifier(c.name) })),
        symbols: parsed.symbols,
    };
}
